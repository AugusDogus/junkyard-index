import type { ConnectorChunkAccounting } from "./connector-chunk";
import { inventoryVin } from "./inventory-vin";
import { pickapartvaHash, type PickapartvaPage } from "./pickapartva-parser";
import {
  mergePickapartvaVehicles,
  pickapartvaStock,
  transformPickapartvaRecord,
  type PickapartvaCanonicalVehicle,
} from "./pickapartva-transform";
import { SourceValidationPolicy } from "./source-validation";
import type { PickapartvaYardCode } from "./pickapartva-yard-metadata";

export interface PickapartvaCounts {
  processed: number;
  emitted: number;
  rejected: number;
  duplicates: number;
}
export interface PickapartvaBucket {
  page: number;
  vehicles: PickapartvaCanonicalVehicle[];
  accounting: ConnectorChunkAccounting;
}
export interface PickapartvaReceipt {
  page: number;
  url: string;
  hash: string;
}
export interface PickapartvaSnapshot {
  hash: string;
  receipts: PickapartvaReceipt[];
  buckets: PickapartvaBucket[];
  observedVins: string[];
  yards: Record<PickapartvaYardCode, PickapartvaCounts>;
}
const empty = (): PickapartvaCounts => ({
  processed: 0,
  emitted: 0,
  rejected: 0,
  duplicates: 0,
});

export function buildPickapartvaSnapshot(
  pages: Array<{ url: string; page: PickapartvaPage }>,
): PickapartvaSnapshot {
  const terminal = pages.at(-1)?.page;
  if (
    !terminal ||
    terminal.nextUrl !== null ||
    terminal.lastPage !== pages.length ||
    pages.some(
      (entry, index) =>
        entry.page.page !== index + 1 ||
        entry.page.lastPage !== terminal.lastPage ||
        (index > 0 && pages[index - 1]?.page.nextUrl !== entry.url),
    ) ||
    new Set(pages.map((entry) => entry.page.hash)).size !== pages.length ||
    new Set(pages.map((entry) => pickapartvaHash(entry.page.records))).size !==
      pages.length
  )
    throw new Error(
      "Pick-A-Part VA global native page chain is incomplete or repeated",
    );
  const yards = { TT87: empty(), UU81: empty() };
  const groups = new Map<
    string,
    { firstPage: number; vehicle: PickapartvaCanonicalVehicle }
  >();
  const identities = new Map<string, string>();
  const stocks = new Map<string, string>();
  const observedVins = new Set<string>();
  const buckets: PickapartvaBucket[] = [];
  for (const entry of pages) {
    const accounting: ConnectorChunkAccounting = {
      recordsProcessed: entry.page.records.length,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    for (const record of entry.page.records) {
      const counts = yards[record.yardCode];
      counts.processed++;
      const vin = inventoryVin(record.vin, record.year);
      const identity = pickapartvaHash([
        record.vin.trim().toUpperCase(),
        record.year,
        record.make.toUpperCase(),
        record.model.toUpperCase(),
        record.yardCode,
      ]);
      const stock = pickapartvaStock(record.stock);
      if (
        (stock && stocks.has(stock) && stocks.get(stock) !== identity) ||
        (vin && identities.has(vin) && identities.get(vin) !== identity)
      )
        throw new Error(
          "Pick-A-Part VA native stock/VIN has conflicting required identity or physical yard",
        );
      if (stock) stocks.set(stock, identity);
      if (vin) identities.set(vin, identity);
      const result = transformPickapartvaRecord(record, entry.page.page);
      if (result.status === "incomplete") {
        accounting.recordsRejected++;
        counts.rejected++;
        if (result.vin) observedVins.add(result.vin);
      } else {
        const prior = groups.get(result.vehicle.vin);
        if (prior) {
          prior.vehicle = mergePickapartvaVehicles(
            prior.vehicle,
            result.vehicle,
          );
          accounting.duplicateVehicles++;
          counts.duplicates++;
        } else {
          groups.set(result.vehicle.vin, {
            firstPage: entry.page.page,
            vehicle: result.vehicle,
          });
          counts.emitted++;
        }
      }
    }
    buckets.push({ page: entry.page.page, vehicles: [], accounting });
  }
  for (const group of groups.values()) {
    const bucket = buckets[group.firstPage - 1];
    if (!bucket)
      throw new Error(
        "Pick-A-Part VA donor first occurrence has no native page partition",
      );
    bucket.vehicles.push(group.vehicle);
  }
  for (const [yard, counts] of Object.entries(yards)) {
    if (
      counts.emitted < 1 ||
      counts.processed !==
        counts.emitted + counts.rejected + counts.duplicates ||
      counts.rejected / counts.processed >
        SourceValidationPolicy.maximumRejectionRatio ||
      counts.duplicates / counts.processed >
        SourceValidationPolicy.maximumDuplicateRatio
    )
      throw new Error(
        `Pick-A-Part VA ${yard} quality/reconciliation failed: ${counts.rejected} rejected, ${counts.duplicates} duplicate, ${counts.processed} raw donors; retain the existing 10% rejection and 25% duplicate limits`,
      );
  }
  const receipts = pages.map((entry) => ({
    url: entry.url,
    page: entry.page.page,
    hash: entry.page.hash,
  }));
  return {
    hash: pickapartvaHash(
      receipts.map((receipt) => [receipt.page, receipt.url, receipt.hash]),
    ),
    receipts,
    buckets,
    observedVins: [...observedVins],
    yards,
  };
}

export function pickapartvaPrefix(
  snapshot: PickapartvaSnapshot,
  nextPage: number,
): PickapartvaCounts {
  return snapshot.buckets.slice(0, nextPage - 1).reduce<PickapartvaCounts>(
    (counts, bucket) => ({
      processed: counts.processed + bucket.accounting.recordsProcessed,
      emitted: counts.emitted + bucket.vehicles.length,
      rejected: counts.rejected + bucket.accounting.recordsRejected,
      duplicates: counts.duplicates + bucket.accounting.duplicateVehicles,
    }),
    empty(),
  );
}
