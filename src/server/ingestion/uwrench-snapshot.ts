import {
  parseVinplusSearch,
  vinplusOptionalText,
  vinplusSourceDate,
} from "./vinplus-protocol";
import type { UwrenchContext } from "./uwrench-client";
import type {
  UwrenchRunningCursor,
  UwrenchEntry,
  UwrenchReceipt,
} from "./uwrench-cursor";
import {
  UWRENCH_SCOPE,
  UwrenchStockSchema,
  uwrenchHash,
  uwrenchNativeDate,
  type UwrenchNativeRow,
  type UwrenchPair,
  type UwrenchRecord,
} from "./uwrench-parser";
import {
  transformUwrenchExtra,
  transformUwrenchRow,
  uwrenchRecordVin,
  uwrenchStableRecord,
  type UwrenchDisposition,
} from "./uwrench-transform";
import { SourceValidationPolicy } from "./source-validation";

export function uwrenchQueryHash(
  pair: UwrenchPair,
  records: readonly UwrenchRecord[],
): string {
  return uwrenchHash({
    pair,
    records: [...records]
      .sort((a, b) => (a.stock < b.stock ? -1 : a.stock > b.stock ? 1 : 0))
      .map(uwrenchStableRecord),
  });
}
function validateJoin(
  row: UwrenchNativeRow | undefined,
  record: UwrenchRecord,
): void {
  if (!row) return; // Same-owned API-only stock is a quarantine, never an active native donor.
  const make = vinplusOptionalText(record.make);
  const nativeMake = vinplusOptionalText(row.make);
  const position = vinplusOptionalText(record.vehicleRow);
  const nativePosition = vinplusOptionalText(row.row);
  const date = vinplusSourceDate(record.dateAdded);
  const nativeDate = uwrenchNativeDate(row.sourceSetDate);
  if (
    (row.year !== null && row.year !== record.year) ||
    (make && nativeMake && make !== nativeMake) ||
    (position && nativePosition && position !== nativePosition) ||
    (date &&
      nativeDate &&
      date.slice(5, 7) + "/" + date.slice(8, 10) + "/" + date.slice(2, 4) !==
        nativeDate)
  )
    throw new Error(
      "Tri-State native stock/year/make/position/calendar conflicts for " +
        record.stock,
    );
}
export interface UwrenchSnapshot {
  records: Map<string, UwrenchRecord>;
  dispositions: Map<string, UwrenchDisposition>;
  observations: number;
}
export function rebuildUwrenchPrefix(
  context: UwrenchContext,
  cursor: UwrenchRunningCursor,
): UwrenchSnapshot {
  if (
    cursor.contextHash !== context.hash ||
    cursor.pairCount !== context.pairs.length
  )
    throw new Error(
      "Tri-State native rows, owner/config or API count context changed; restart instead of skipping prior donors",
    );
  const entries = new Map<string, UwrenchEntry>();
  for (const entry of cursor.entries) {
    const stock = UwrenchStockSchema.parse(entry.record.stock);
    if (entries.has(stock))
      throw new Error("Tri-State checkpoint duplicates whole stock " + stock);
    entries.set(stock, entry);
  }
  const records = new Map<string, UwrenchRecord>();
  let observations = 0;
  for (const [index, receipt] of cursor.scanReceipts.entries()) {
    const pair = context.pairs[index];
    if (!pair)
      throw new Error(
        "Tri-State checkpoint query prefix exceeds the native directory",
      );
    const matches = receipt.stocks.map((stock) => {
      const entry = entries.get(stock);
      if (!entry)
        throw new Error(
          "Tri-State checkpoint query references missing whole stock " + stock,
        );
      return entry.record;
    });
    const parsed = parseVinplusSearch(
      JSON.stringify({
        success: true,
        match_count: matches.length,
        matches,
        search_criteria: {
          yard_id: UWRENCH_SCOPE.yardId,
          year_min: null,
          year_max: null,
          make: pair.make,
          model: pair.model,
        },
      }),
      UWRENCH_SCOPE,
      pair,
    );
    if (uwrenchQueryHash(pair, parsed) !== receipt.stableHash)
      throw new Error(
        "Tri-State checkpoint whole-query fingerprint changed at " + index,
      );
    for (const record of parsed) {
      const entry = entries.get(record.stock);
      if (!records.has(record.stock) && entry?.firstQuery !== index)
        throw new Error(
          "Tri-State checkpoint first-discovery index skips native query coverage",
        );
      records.set(record.stock, record);
    }
    observations += parsed.length;
  }
  if (entries.size !== records.size)
    throw new Error(
      "Tri-State checkpoint has uncovered whole stock records outside its complete prefix",
    );
  const native = new Map(context.rows.map((row) => [row.stock, row]));
  const vins = new Map<string, string>();
  const dispositions = new Map<string, UwrenchDisposition>();
  for (const record of records.values()) {
    const row = native.get(record.stock);
    validateJoin(row, record);
    const vin = uwrenchRecordVin(record);
    if (vin) {
      const prior = vins.get(vin);
      if (prior && prior !== record.stock)
        throw new Error(
          "Different Tri-State stocks reuse valid VIN/serial " + vin,
        );
      vins.set(vin, record.stock);
    }
    dispositions.set(
      record.stock,
      row ? transformUwrenchRow(row, record) : transformUwrenchExtra(record),
    );
  }
  if (cursor.phase === "verify") {
    for (const row of context.rows)
      if (!records.has(row.stock))
        dispositions.set(row.stock, transformUwrenchRow(row, undefined));
  }
  return { records, dispositions, observations };
}
export function appendUwrenchRecords(
  entries: UwrenchEntry[],
  receipts: UwrenchReceipt[],
  pair: UwrenchPair,
  index: number,
  records: readonly UwrenchRecord[],
  rawHash: string,
): void {
  const seen = new Map(
    entries.map((entry) => [
      UwrenchStockSchema.parse(entry.record.stock),
      entry,
    ]),
  );
  for (const record of records) {
    const prior = seen.get(record.stock);
    if (prior) {
      const parsed = parseVinplusSearch(
        JSON.stringify({
          success: true,
          match_count: 1,
          matches: [prior.record],
          search_criteria: {
            yard_id: UWRENCH_SCOPE.yardId,
            year_min: null,
            year_max: null,
            make: pair.make,
            model: pair.model,
          },
        }),
        UWRENCH_SCOPE,
        pair,
      )[0];
      if (
        !parsed ||
        uwrenchHash(uwrenchStableRecord(parsed)) !==
          uwrenchHash(uwrenchStableRecord(record))
      )
        throw new Error(
          "Repeated Tri-State stock changed whole stable source record " +
            record.stock,
        );
    } else {
      const entry = { firstQuery: index, record: { ...record } };
      entries.push(entry);
      seen.set(record.stock, entry);
    }
  }
  receipts.push({
    rawHash,
    stableHash: uwrenchQueryHash(pair, records),
    stocks: records.map((record) => record.stock).sort(),
  });
}
export function validateUwrenchScan(
  context: UwrenchContext,
  snapshot: UwrenchSnapshot,
): void {
  const years = new Map<number, number>();
  for (const record of snapshot.records.values())
    years.set(record.year, (years.get(record.year) ?? 0) + 1);
  const byYear = [...years]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year - b.year);
  if (
    snapshot.records.size !== context.counts.count ||
    JSON.stringify(byYear) !== JSON.stringify(context.counts.years)
  )
    throw new Error(
      "Tri-State complete API union does not reconcile with its own published count/year buckets",
    );
  const rejected = [...snapshot.dispositions.values()].filter(
    (entry) => entry.status === "rejected",
  ).length;
  if (
    snapshot.dispositions.size === rejected ||
    rejected / snapshot.dispositions.size >
      SourceValidationPolicy.maximumRejectionRatio
  )
    throw new Error(
      "Tri-State required union rejection ratio exceeds 10% or leaves no valid native donors",
    );
}
