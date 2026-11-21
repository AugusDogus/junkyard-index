import type { ConnectorChunkAccounting } from "./connector-chunk";
import { inventoryVin } from "./inventory-vin";
import {
  pickapartvaHash,
  type PickapartvaPage,
  type PickapartvaRecord,
  type PickapartvaSearchPage,
} from "./pickapartva-parser";
import {
  mergePickapartvaVehicles,
  pickapartvaStock,
  transformPickapartvaRecord,
  type PickapartvaCanonicalVehicle,
  type PickapartvaListing,
} from "./pickapartva-transform";
import { SourceValidationPolicy } from "./source-validation";
import {
  pickapartvaSearchHref,
  pickapartvaSearchScopes,
  type PickapartvaYardCode,
} from "./pickapartva-yard-metadata";

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
export interface PickapartvaSearchReceipt {
  date: string;
  url: string;
  hash: string;
}
export interface PickapartvaSnapshot {
  hash: string;
  receipts: PickapartvaReceipt[];
  searches: PickapartvaSearchReceipt[];
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

/** Covers every page and set-date search; without searches it is the page
 * receipt hash used by earlier checkpoints. */
export function pickapartvaSnapshotHash(
  receipts: PickapartvaReceipt[],
  searches: PickapartvaSearchReceipt[],
) {
  return pickapartvaHash([
    ...receipts.map((receipt) => [receipt.page, receipt.url, receipt.hash]),
    ...searches.map((search) => [search.date, search.url, search.hash]),
  ]);
}

const cardKey = (record: PickapartvaRecord) =>
  JSON.stringify([
    record.stock,
    record.vin.trim().toUpperCase(),
    record.setDate,
  ]);

/** A catalog card that repeats a native card already shown on an earlier page. */
interface RepeatSlot {
  page: number;
  index: number;
  date: string;
}

/**
 * The catalog orders by Set Date with LIMIT/OFFSET on that non-unique key, so
 * each offset may order a date's donors differently. A date's donors still
 * fill one fixed contiguous run of slots, so every card of that date repeated
 * on a later page stands in for exactly one donor of that date that no page
 * showed. Returns those repeated slots in catalog order, after checking the
 * page chain so a repeated page fails as a chain defect, not as ties.
 */
function pickapartvaRepeatSlots(
  pages: Array<{ url: string; page: PickapartvaPage }>,
): RepeatSlot[] {
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
  const firstPage = new Map<string, number>();
  const repeats: RepeatSlot[] = [];
  let previous: string | null = null;
  let ordered = true;
  for (const entry of pages)
    entry.page.records.forEach((record, index) => {
      if (previous !== null && record.setDate > previous) ordered = false;
      previous = record.setDate;
      const key = cardKey(record);
      const first = firstPage.get(key);
      if (first === undefined) firstPage.set(key, entry.page.page);
      else if (first < entry.page.page)
        repeats.push({ page: entry.page.page, index, date: record.setDate });
    });
  if (repeats.length && !ordered)
    throw new Error(
      "Pick-A-Part VA catalog repeats donors across pages but is no longer ordered by Set Date, so the hidden donors cannot be located",
    );
  return repeats;
}

/** The Set Dates whose donors the page chain repeated, in catalog order. Each
 * needs one set-date search to recover the donors it hid. */
export function pickapartvaTieDates(
  pages: Array<{ url: string; page: PickapartvaPage }>,
): string[] {
  return [...new Set(pickapartvaRepeatSlots(pages).map((slot) => slot.date))];
}

export function buildPickapartvaSnapshot(
  pages: Array<{ url: string; page: PickapartvaPage }>,
  searches: Array<{ url: string; page: PickapartvaSearchPage }>,
): PickapartvaSnapshot {
  const repeats = pickapartvaRepeatSlots(pages);
  const dates = [...new Set(repeats.map((slot) => slot.date))];
  if (
    JSON.stringify(
      searches.map((search) => [search.url, search.page.date, search.page.id]),
    ) !==
    JSON.stringify(
      dates.flatMap((date) =>
        pickapartvaSearchScopes(
          searches.filter((search) => search.page.date === date).length,
        ).map((id) => [pickapartvaSearchHref(date, id), date, id]),
      ),
    )
  )
    throw new Error(
      `Pick-A-Part VA set-date searches do not match the catalog's repeated Set Dates (${dates.join(", ") || "none"})`,
    );
  // Pair each repeated slot with one donor its date's search adds, so every
  // catalog slot still accounts for exactly one native donor.
  const replacements = new Map<
    string,
    { record: PickapartvaRecord; listing: PickapartvaListing }
  >();
  const shown = new Set(
    pages.flatMap((entry) => entry.page.records.map(cardKey)),
  );
  for (const date of dates) {
    const slots = repeats.filter((slot) => slot.date === date);
    // A date split by yard is the union of its disjoint yard partitions.
    const found = searches
      .filter((search) => search.page.date === date)
      .flatMap((search) =>
        search.page.records.map((record) => ({ record, id: search.page.id })),
      );
    const keys = found.map(({ record }) => cardKey(record));
    if (new Set(keys).size !== keys.length)
      throw new Error(
        `Pick-A-Part VA set-date search for ${date} repeats a native donor card`,
      );
    const hidden = found.filter(({ record }) => !shown.has(cardKey(record)));
    if (hidden.length !== slots.length)
      throw new Error(
        `Pick-A-Part VA set-date search for ${date} adds ${hidden.length} donors, but the catalog repeated ${slots.length} cards of that date; the inventory changed between reads, so completeness is unproven`,
      );
    slots.forEach((slot, index) => {
      const entry = hidden[index];
      if (entry)
        replacements.set(`${slot.page}:${slot.index}`, {
          record: entry.record,
          listing: { search: date, id: entry.id },
        });
    });
  }
  const yards = { TT87: empty(), UU81: empty() };
  const groups = new Map<
    string,
    { firstPage: number; vehicle: PickapartvaCanonicalVehicle }
  >();
  const identities = new Map<string, string>();
  const stocks = new Map<string, string>();
  const bind = (record: PickapartvaRecord) => {
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
  };
  for (const entry of pages) entry.page.records.forEach(bind);
  for (const search of searches) search.page.records.forEach(bind);
  const observedVins = new Set<string>();
  const buckets: PickapartvaBucket[] = [];
  for (const entry of pages) {
    const accounting: ConnectorChunkAccounting = {
      recordsProcessed: entry.page.records.length,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    entry.page.records.forEach((shownRecord, index) => {
      const replacement = replacements.get(`${entry.page.page}:${index}`);
      const record = replacement?.record ?? shownRecord;
      const counts = yards[record.yardCode];
      counts.processed++;
      const result = transformPickapartvaRecord(
        record,
        replacement?.listing ?? entry.page.page,
      );
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
    });
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
  const searchReceipts = searches.map((search) => ({
    date: search.page.date,
    url: search.url,
    hash: search.page.hash,
  }));
  return {
    hash: pickapartvaSnapshotHash(receipts, searchReceipts),
    receipts,
    searches: searchReceipts,
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
