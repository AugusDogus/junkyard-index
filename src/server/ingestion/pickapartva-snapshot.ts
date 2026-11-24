import type { ConnectorChunkAccounting } from "./connector-chunk";
import { inventoryVin } from "./inventory-vin";
import {
  pickapartvaCardKey,
  pickapartvaHash,
  type PickapartvaPage,
  type PickapartvaRecord,
} from "./pickapartva-parser";
import {
  PickapartvaRecovery,
  type PickapartvaTie,
} from "./pickapartva-recovery";
import {
  mergePickapartvaVehicles,
  pickapartvaStock,
  transformPickapartvaRecord,
  type PickapartvaCanonicalVehicle,
  type PickapartvaListing,
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

const cardKey = pickapartvaCardKey;
/** A donor's valid VIN and native stock, the identities `bind` holds to one
 * donor. */
const identifiers = (record: PickapartvaRecord) => {
  const vin = inventoryVin(record.vin, record.year);
  const stock = pickapartvaStock(record.stock);
  return [...(vin ? ["vin:" + vin] : []), ...(stock ? ["stock:" + stock] : [])];
};

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
      // One page is one native query, so it can list a donor only once.
      else
        throw new Error(
          `Pick-A-Part VA catalog lists one donor card twice on page ${entry.page.page} (stock ${record.stock}, Set Date ${record.setDate}), so its repeated slots cannot be counted`,
        );
    });
  if (repeats.length && !ordered)
    throw new Error(
      "Pick-A-Part VA catalog repeats donors across pages but is no longer ordered by Set Date, so the hidden donors cannot be located",
    );
  return repeats;
}

/** The Set Dates whose donors the page chain repeated, in catalog order, each
 * with how many cards it repeated and the donors it showed. Each needs
 * set-date searches to recover the donors it hid. */
export function pickapartvaTies(
  pages: Array<{ url: string; page: PickapartvaPage }>,
): PickapartvaTie[] {
  const repeats = pickapartvaRepeatSlots(pages);
  const dates = [...new Set(repeats.map((slot) => slot.date))];
  return dates.map((date) => ({
    date,
    slots: repeats.filter((slot) => slot.date === date).length,
    shown: [
      ...new Set(
        pages.flatMap((entry) =>
          entry.page.records
            .filter((record) => record.setDate === date)
            .map(cardKey),
        ),
      ),
    ].sort(),
  }));
}

/** Every catalog page with each repeated slot replaced by one hidden donor
 * its date's recovery found. Each tie date needs exactly one resolved
 * recovery planned for the same repeated slots and shown donors. */
export function buildPickapartvaSnapshot(
  pages: Array<{ url: string; page: PickapartvaPage }>,
  recoveries: readonly PickapartvaRecovery[],
): PickapartvaSnapshot {
  const repeats = pickapartvaRepeatSlots(pages);
  const ties = pickapartvaTies(pages);
  if (
    recoveries.length !== ties.length ||
    ties.some((tie, index) => {
      const recovery = recoveries[index];
      return (
        recovery === undefined ||
        !PickapartvaRecovery.matches(recovery, tie) ||
        !PickapartvaRecovery.resolved(recovery) ||
        recovery.hidden.length !== tie.slots
      );
    })
  )
    throw new Error(
      `Pick-A-Part VA set-date searches do not match the catalog's repeated Set Dates (${ties.map((tie) => tie.date).join(", ") || "none"})`,
    );
  // Pair each repeated slot with one hidden donor of its date, so every
  // catalog slot still accounts for exactly one native donor.
  const replacements = new Map<
    string,
    { record: PickapartvaRecord; listing: PickapartvaListing }
  >();
  const shown = new Set(
    pages.flatMap((entry) => entry.page.records.map(cardKey)),
  );
  const recovered = new Set<string>();
  for (const recovery of recoveries) {
    // A card key holds stock, VIN and Set Date, so a search that lists a
    // shown donor under another stock or VIN text would pass as hidden.
    const dated = pages.flatMap((entry) =>
      entry.page.records.filter((record) => record.setDate === recovery.date),
    );
    const held = new Set(dated.flatMap(identifiers));
    const reused = recovery.hidden.find(({ record }) =>
      identifiers(record).some((identifier) => held.has(identifier)),
    );
    if (reused)
      throw new Error(
        `Pick-A-Part VA recovered donor ${reused.record.stock || "without a stock"} for ${recovery.date} has the VIN or stock of a donor the catalog showed for that date under another card, so the set-date search no longer matches the catalog's donor cards and the hidden donor is unproven. Compare the ${reused.id} ${reused.make} search with the catalog cards of that VIN or stock`,
      );
    const slots = repeats.filter((slot) => slot.date === recovery.date);
    slots.forEach((slot, index) => {
      const donor = recovery.hidden[index];
      const key = donor && cardKey(donor.record);
      if (
        !donor ||
        key === undefined ||
        donor.record.setDate !== recovery.date ||
        shown.has(key) ||
        recovered.has(key)
      )
        throw new Error(
          `Pick-A-Part VA recovered donors for ${recovery.date} are shown, repeated or set on another date`,
        );
      recovered.add(key);
      replacements.set(`${slot.page}:${slot.index}`, {
        record: donor.record,
        listing: { search: recovery.date, id: donor.id, make: donor.make },
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
  for (const recovery of recoveries)
    for (const donor of recovery.hidden) bind(donor.record);
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
  const searchReceipts = recoveries.flatMap((recovery) =>
    recovery.searches.map((search) => ({
      date: recovery.date,
      url: search.url,
      hash: search.hash,
    })),
  );
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
