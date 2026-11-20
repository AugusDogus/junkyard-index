import type { Alln1Seen, Alln1SetDates, Alln1Tie } from "./alln1-cursor";
import {
  alln1Hash,
  alln1SourceDate,
  alln1Stock,
  type Alln1Record,
  type Alln1Search,
} from "./alln1-parser";
import {
  transformUpullRecord,
  type Alln1CanonicalVehicle,
} from "./alln1-transform";
import type { Alln1Source, Alln1Tenant } from "./alln1-yard-metadata";
import { SourceValidationPolicy } from "./source-validation";

/**
 * The census read so far. The catalog orders by Set Date with LIMIT/OFFSET
 * on that non-unique key, so each offset may order a date's donors
 * differently. Dates still fill fixed contiguous runs of slots, so a donor of
 * a date split across a page boundary can show on both pages while another
 * of that date shows on neither. Each such repeat stands in for exactly one
 * hidden donor of that date, which its Set Date search recovers.
 * `setDates` is null before the first donor.
 */
export interface Alln1Census {
  seen: readonly Alln1Seen[];
  setDates: Alln1SetDates | null;
}
export const ALLN1_EMPTY_CENSUS: Alln1Census = { seen: [], setDates: null };

export interface Alln1Admitted<S extends Alln1Source> {
  census: Alln1Census;
  vehicles: Alln1CanonicalVehicle<S>[];
  observedVins: string[];
  /** Distinct donors admitted, accepted or rejected. */
  processed: number;
  rejected: number;
  /** Rows that repeated a donor of the previous page at a Set Date tie. */
  repeats: number;
}

const REPEAT_ERROR =
  "Native pages repeat a donor VIN/serial, stock or complete source record";

function identify<S extends Alln1Source>(
  record: Alln1Record,
  tenant: Alln1Tenant<S>,
) {
  const result = transformUpullRecord(record, tenant);
  return {
    result,
    vin: result.status === "available" ? result.vehicle.vin : result.vin,
    stock: alln1Stock(record.stock),
    hash: alln1Hash(record),
  };
}
type Identity<S extends Alln1Source> = ReturnType<typeof identify<S>>;

/** Cumulative identities, admitting each donor once through the transform. */
function ledger<S extends Alln1Source>(
  census: Alln1Census,
  tenant: Alln1Tenant<S>,
) {
  const seen = [...census.seen];
  const vins = new Set(seen.flatMap((entry) => (entry.vin ? [entry.vin] : [])));
  const stocks = new Set(
    seen.flatMap((entry) => (entry.stock ? [entry.stock] : [])),
  );
  const pages = new Map(seen.map((entry) => [entry.hash, entry.firstPage]));
  const vehicles: Alln1CanonicalVehicle<S>[] = [];
  const observedVins: string[] = [];
  let processed = 0,
    rejected = 0;
  return {
    seen,
    identify: (record: Alln1Record) => identify(record, tenant),
    /** Whether `identity` repeats an admitted VIN/serial, stock or record. */
    repeats: ({ vin, stock, hash }: Identity<S>) =>
      (vin !== null && vins.has(vin)) ||
      (stock !== null && stocks.has(stock)) ||
      pages.has(hash),
    /** The page that first showed this complete record, if any. */
    firstPage: (hash: string) => pages.get(hash) ?? null,
    admit({ result, vin, stock, hash }: Identity<S>, page: number) {
      if (vin) vins.add(vin);
      if (stock) stocks.add(stock);
      pages.set(hash, page);
      processed++;
      const common = { hash, stock, firstPage: page };
      if (result.status === "available") {
        seen.push({ ...common, status: "available", vin: result.vehicle.vin });
        vehicles.push(result.vehicle);
      } else {
        rejected++;
        if (vin) observedVins.push(vin);
        seen.push(
          result.status === "quarantined"
            ? {
                ...common,
                status: "quarantined",
                position: result.position,
                vin,
              }
            : { ...common, status: "incomplete", vin },
        );
      }
    },
    totals: () => ({ vehicles, observedVins, processed, rejected }),
  };
}

const copyTie = (tie: Alln1Tie): Alln1Tie => ({
  ...tie,
  hashes: [...tie.hashes],
});

/** Set Date runs after one more donor dated `date` (null when invalid). */
function nextSetDates(
  setDates: Alln1SetDates | null,
  date: string | null,
): Alln1SetDates {
  if (setDates === null)
    return date === null
      ? { status: "unordered" }
      : { status: "ordered", run: { date, repeats: 0, hashes: [] }, ties: [] };
  if (setDates.status === "unordered" || date === setDates.run.date)
    return setDates;
  if (date === null || date > setDates.run.date) {
    if (setDates.run.repeats > 0 || setDates.ties.length > 0)
      throw new Error(
        "All-N-1 census repeated donors at a Set Date tie but is no longer ordered by Set Date, so the donors that tie hid cannot be located",
      );
    return { status: "unordered" };
  }
  return {
    status: "ordered",
    run: { date, repeats: 0, hashes: [] },
    ties:
      setDates.run.repeats > 0
        ? [...setDates.ties, setDates.run]
        : setDates.ties,
  };
}

/**
 * Admits one catalog page. A row may repeat an earlier donor only as the
 * identical native record from the immediately preceding page, dated with
 * both that page's last Set Date and this page's first: a tie split across
 * the boundary. That row is counted once as a repeat of its date and neither
 * emitted nor admitted again. Any other repeat throws.
 */
export function admitAlln1Page<S extends Alln1Source>(
  census: Alln1Census,
  records: readonly Alln1Record[],
  page: number,
  tenant: Alln1Tenant<S>,
): Alln1Admitted<S> {
  const book = ledger(census, tenant);
  const boundary =
    census.setDates?.status === "ordered" ? census.setDates.run : null;
  const firstDate = records[0]?.setDate ?? null;
  let setDates: Alln1SetDates | null =
    census.setDates?.status === "ordered"
      ? {
          status: "ordered",
          run: copyTie(census.setDates.run),
          ties: census.setDates.ties.map(copyTie),
        }
      : census.setDates;
  const repeatedHere = new Set<string>();
  let repeats = 0;
  for (const record of records) {
    const date = alln1SourceDate(record.setDate);
    setDates = nextSetDates(setDates, date);
    const identity = book.identify(record);
    if (book.repeats(identity)) {
      if (
        setDates.status !== "ordered" ||
        boundary === null ||
        page < 2 ||
        book.firstPage(identity.hash) !== page - 1 ||
        repeatedHere.has(identity.hash) ||
        !boundary.hashes.includes(identity.hash) ||
        date !== boundary.date ||
        record.setDate !== firstDate
      )
        throw new Error(REPEAT_ERROR);
      repeatedHere.add(identity.hash);
      setDates.run.repeats++;
      repeats++;
      continue;
    }
    book.admit(identity, page);
    if (setDates.status === "ordered") setDates.run.hashes.push(identity.hash);
  }
  if (setDates === null)
    throw new Error("All-N-1 native page " + page + " has no donor rows");
  return {
    census: { seen: book.seen, setDates },
    ...book.totals(),
    repeats,
  };
}

/** Set Dates whose donors a page boundary repeated, in catalog order. Each
 * needs one Set Date search to recover the donors it hid. */
export function alln1PendingTies(census: Alln1Census): Alln1Tie[] {
  const setDates = census.setDates;
  if (setDates?.status !== "ordered") return [];
  return setDates.run.repeats > 0
    ? [...setDates.ties, setDates.run]
    : setDates.ties;
}

/**
 * Completes a census whose last page has been admitted. Each pending tie's
 * Set Date search must list every census donor of that date and add exactly
 * as many unseen donors as the catalog repeated; those donors are admitted
 * through the same transform and identity checks as page rows. The 10%
 * rejection limit then applies to the whole yard.
 */
export function completeAlln1Census<S extends Alln1Source>(
  census: Alln1Census,
  searches: readonly Alln1Search[],
  page: number,
  receipts: number,
  lastPage: number,
  tenant: Alln1Tenant<S>,
): Alln1Admitted<S> {
  const ties = alln1PendingTies(census);
  if (
    JSON.stringify(searches.map((search) => search.date)) !==
    JSON.stringify(ties.map((tie) => tie.date))
  )
    throw new Error(
      "All-N-1 Set Date searches do not match the census's repeated Set Dates (" +
        (ties.map((tie) => tie.date).join(", ") || "none") +
        ")",
    );
  const book = ledger(census, tenant);
  ties.forEach((tie, index) => {
    const search = searches[index];
    const records = search?.records ?? [];
    const hashes = records.map((record) => alln1Hash(record));
    const listed = new Set(hashes);
    const shown = new Set(tie.hashes);
    const missing = tie.hashes.filter((hash) => !listed.has(hash)).length;
    const hidden = records.filter((_, i) => !shown.has(hashes[i] ?? ""));
    if (
      listed.size !== hashes.length ||
      missing > 0 ||
      hidden.length !== tie.repeats
    )
      throw new Error(
        "All-N-1 Set Date search for " +
          tie.date +
          " lists " +
          records.length +
          " donors, omits " +
          missing +
          " census donors of that date and adds " +
          hidden.length +
          ", but the catalog repeated " +
          tie.repeats +
          " donors of that date across a page boundary. The inventory changed during the crawl, so completeness is unproven; rerun the census",
      );
    for (const record of hidden) {
      const identity = book.identify(record);
      if (book.repeats(identity)) throw new Error(REPEAT_ERROR);
      book.admit(identity, page);
    }
  });
  const seen = book.seen;
  const totalRejected = seen.filter(
    (entry) => entry.status !== "available",
  ).length;
  if (
    receipts !== lastPage ||
    totalRejected === seen.length ||
    totalRejected / seen.length > SourceValidationPolicy.maximumRejectionRatio
  )
    throw new Error(
      totalRejected +
        " rejected or quarantined of " +
        seen.length +
        " donors exceeds the unchanged 10% rejection limit or lacks complete valid yard coverage",
    );
  return {
    census: { seen, setDates: census.setDates },
    ...book.totals(),
    repeats: 0,
  };
}
