import { z } from "zod";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import { SourceValidationPolicy } from "./source-validation";
import { inventoryVin } from "./inventory-vin";
import { BYOT_YARDS } from "./byot-configuration";
import { byotHash, type ByotCache } from "./byot-cursor";
import {
  byotRecord,
  transformByotRecord,
  type ByotRecord,
} from "./byot-record";
import { ByotResult } from "./byot-result";
import type { CanonicalVehicle } from "./types";

const claims = z.object({
  StockId: z.string().trim().optional(),
  VIN: z.string().optional().catch(undefined),
  Year: z.number().optional().catch(undefined),
  images: z.unknown().optional(),
});
const identity = (row: ByotRecord) =>
  byotHash([
    row.VehicleRno,
    row.VIN,
    row.Year,
    row.Make.toUpperCase(),
    row.Model.toUpperCase(),
  ]);
export function byotSnapshot(
  feeds: readonly unknown[][],
  cache: ByotCache,
  previousCounts: readonly number[] = [],
) {
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: 0,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  };
  const candidates: { vehicle: CanonicalVehicle; duplicates: number }[] = [],
    observedVins = new Set<string>();
  for (const [yardIndex, yard] of BYOT_YARDS.entries()) {
    const groups = new Map<
      string,
      {
        checkedAt: number;
        photographed: boolean;
        records: ByotRecord[];
        rejected: boolean;
        vins: Set<string>;
        duplicates: number;
      }
    >();
    const batches = [
      { records: feeds[yardIndex] ?? [], checkedAt: Infinity },
      ...(cache[yardIndex] ?? [])
        .slice()
        .sort((a, b) => b.checkedAt - a.checkedAt),
    ];
    for (const batch of batches) {
      const batchStocks = new Set<string>();
      for (const raw of batch.records) {
        const native = claims.safeParse(raw);
        const key =
          native.success && native.data.StockId
            ? native.data.StockId
            : byotHash(raw);
        const existing = groups.get(key);
        const group = existing ?? {
          checkedAt: batch.checkedAt,
          photographed: false,
          records: [],
          rejected: false,
          duplicates: 0,
          vins: new Set<string>(),
        };
        if (
          native.success &&
          Array.isArray(native.data.images) &&
          native.data.images.length
        )
          group.photographed = true;
        // The feed owns photographed stock; otherwise use the latest refresh.
        if (existing && existing.checkedAt > batch.checkedAt) continue;
        const record = byotRecord(raw, yard);
        if (native.success && native.data.VIN) {
          const vin = inventoryVin(
            native.data.VIN,
            String(native.data.Year ?? ""),
          );
          if (vin) group.vins.add(vin);
        }
        if (record) group.records.push(record);
        else group.rejected = true;
        if (batchStocks.has(key)) group.duplicates++;
        batchStocks.add(key);
        groups.set(key, group);
      }
    }
    for (const group of groups.values()) {
      // The complete feed would include a photographed stock if it were still present.
      if (group.checkedAt !== Infinity && group.photographed) continue;
      accounting.recordsProcessed += 1 + group.duplicates;
      const row = group.records.at(-1);
      if (
        group.rejected ||
        !row ||
        new Set(group.records.map(identity)).size !== 1
      ) {
        accounting.recordsRejected += 1 + group.duplicates;
        for (const vin of group.vins) observedVins.add(vin);
      } else
        candidates.push({
          vehicle: transformByotRecord(row, yard),
          duplicates: group.duplicates,
        });
    }
  }
  const byVin = new Map<string, typeof candidates>();
  for (const candidate of candidates)
    byVin.set(candidate.vehicle.vin, [
      ...(byVin.get(candidate.vehicle.vin) ?? []),
      candidate,
    ]);
  const vehicles: CanonicalVehicle[] = [];
  for (const [vin, rows] of byVin) {
    const first = rows[0]?.vehicle;
    if (!first) continue;
    if (
      new Set(
        rows.map(({ vehicle: row }) =>
          byotHash([row.year, row.make, row.model, row.locationCode]),
        ),
      ).size > 1
    ) {
      accounting.recordsRejected += rows.reduce(
        (total, row) => total + 1 + row.duplicates,
        0,
      );
      observedVins.add(vin);
    } else {
      vehicles.push(first);
      accounting.duplicateVehicles +=
        rows.length -
        1 +
        rows.reduce((total, row) => total + row.duplicates, 0);
    }
  }
  const yardCounts = BYOT_YARDS.map(
    (yard) =>
      vehicles.filter((vehicle) => vehicle.locationCode === yard.code).length,
  );
  const errors: string[] = [];
  for (const [index, yard] of BYOT_YARDS.entries()) {
    const count = yardCounts[index] ?? 0,
      previous = previousCounts[index];
    if (count < yard.minimumInventory)
      errors.push(
        `${yard.code} inventory ${count} is below qualified floor ${yard.minimumInventory}`,
      );
    if (
      previous !== undefined &&
      count < previous * SourceValidationPolicy.minimumPreviousRunRatio
    )
      errors.push(
        `${yard.code} inventory ${count} fell below 50% of its previous published count ${previous}`,
      );
  }
  const total = accounting.recordsProcessed;
  if (
    total !==
    vehicles.length + accounting.recordsRejected + accounting.duplicateVehicles
  )
    errors.push("native union accounting does not reconcile");
  if (
    !total ||
    accounting.recordsRejected / total >
      SourceValidationPolicy.maximumRejectionRatio
  )
    errors.push(
      `required rejection ${accounting.recordsRejected}/${total} exceeds 10%`,
    );
  if (
    total &&
    accounting.duplicateVehicles / total >
      SourceValidationPolicy.maximumDuplicateRatio
  )
    errors.push(
      `duplicates ${accounting.duplicateVehicles}/${total} exceed 25%`,
    );
  return {
    vehicles,
    observedVins: [...observedVins].sort(),
    yardCounts,
    accounting,
    validation: errors.length
      ? ({
          ok: false,
          error: ByotResult.error("union validation", errors.join("; ")),
        } as const)
      : ({ ok: true, value: undefined } as const),
  };
}
