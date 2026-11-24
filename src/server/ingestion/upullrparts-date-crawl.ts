import { Data, Effect, Either, Schema } from "effect";
import {
  UpullRPartsVehicleSchema,
  type UpullRPartsProviderError,
  type UpullRPartsVehicle,
} from "./upullrparts-client";

/** getVehicles locations: Minnesota (1) covers stores 1 and 2, Toledo (3) store 3. */
export const UPULLRPARTS_LOCATIONS = ["1", "3"] as const;
export type UpullRPartsLocation = (typeof UPULLRPARTS_LOCATIONS)[number];

/** The getVehicles location that lists a store's vehicles, or null for a
 * store this build does not know. */
export function upullRPartsLocationOfStore(
  store: number,
): UpullRPartsLocation | null {
  return store === 1 || store === 2 ? "1" : store === 3 ? "3" : null;
}

/**
 * getVehicles returns at most this many rows and has no paging. Over the
 * limit it returns the newest 100 by arrival date, ordered by store rather
 * than strictly by date, so a full result is never used.
 */
export const UPULLRPARTS_SEARCH_LIMIT = 100;

/** The oldest window starts here, before any vehicle on the site (the oldest
 * stored arrival is 2020-09-03), so the windows reach every vehicle. */
export const UPULLRPARTS_FIRST_DAY = "2000-01-01";

/** Windows are packed to about this many expected vehicles, leaving room
 * under the limit for a day that grew since the snapshot. */
export const UPULLRPARTS_WINDOW_TARGET = 90;

/**
 * One getVehicles search: arrivals (`DateSetData`) from `beginDate` to
 * `endDate`, both inclusive `YYYY-MM-DD` ("" leaves that side open), of
 * `makes` ("" for any make). Dates and make combine with AND. Model and year
 * are always any.
 */
export interface UpullRPartsSearchParams {
  site: UpullRPartsLocation;
  beginDate: string;
  endDate: string;
  makes: string;
}

export type UpullRPartsSearch<E = UpullRPartsProviderError> = (
  params: UpullRPartsSearchParams,
) => Effect.Effect<readonly unknown[], E>;

export class UpullRPartsCrawlError extends Data.TaggedError(
  "UpullRPartsCrawlError",
)<{ message: string }> {}

/** Every location stocks Fords, so an empty Ford search means a blocked IP:
 * getVehicles then returns an empty list for every search. */
const CANARY_MAKE = "Ford";

/** A canary search came back empty, so this chunk's empty results cannot be
 * trusted and nothing from it may be emitted. */
export class UpullRPartsSearchBlocked extends Data.TaggedError(
  "UpullRPartsSearchBlocked",
)<{ site: UpullRPartsLocation; when: "before" | "during" | "after" }> {
  override get message() {
    return `U Pull R Parts getVehicles returned no ${CANARY_MAKE} vehicles at location ${this.site} ${this.when} the crawl, twice with fresh tokens, so it is most likely blocking this IP, which it does for over an hour after more than about 13 searches in a minute. The chunk's empty results cannot be trusted, so it emitted no batches and prior inventory is preserved.`;
  }
}

/** The most searches one canary sends: a single rejected token also returns
 * an empty list, so an empty canary is searched once more. */
export const UPULLRPARTS_CANARY_SEARCHES = 2;

/**
 * A Ford search with open dates, sent again with a fresh token when it
 * comes back empty, since one rejected token returns `[]` too. Fails with
 * {@link UpullRPartsSearchBlocked} when both are empty; succeeds with the
 * searches it sent.
 */
export function checkUpullRPartsSearch<S>(
  site: UpullRPartsLocation,
  search: UpullRPartsSearch<S>,
  when: "before" | "during" | "after",
): Effect.Effect<number, S | UpullRPartsSearchBlocked> {
  return Effect.gen(function* () {
    for (let sent = 1; sent <= UPULLRPARTS_CANARY_SEARCHES; sent++) {
      const rows = yield* search({
        site,
        beginDate: "",
        endDate: "",
        makes: CANARY_MAKE,
      });
      if (rows.length > 0) return sent;
    }
    return yield* new UpullRPartsSearchBlocked({ site, when });
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Arrival days as `YYYY-MM-DD` in UTC, as getVehicles takes and returns
 * them. */
export const UpullRPartsDay = {
  /** The UTC day of `ms`. Never earlier than a US yard's local day, so an
   * end date of today includes every arrival so far. */
  of(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  },
  add(day: string, days: number): string {
    return UpullRPartsDay.of(
      Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS,
    );
  },
  /** Days from `from` to `to`, negative when `to` is earlier. */
  between(from: string, to: string): number {
    return Math.round(
      (Date.parse(`${to}T00:00:00.000Z`) -
        Date.parse(`${from}T00:00:00.000Z`)) /
        DAY_MS,
    );
  },
  /** The yards set vehicles out Monday to Friday only. */
  isBusinessDay(day: string): boolean {
    const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
    return weekday >= 1 && weekday <= 5;
  },
  /** `value` when it is a real `YYYY-MM-DD` day, else null. */
  parse(value: string | null | undefined): string | null {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const ms = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isNaN(ms) || UpullRPartsDay.of(ms) !== value ? null : value;
  },
} as const;

/** A planned search: arrivals from `beginDate` to `endDate`, inclusive, of
 * which the snapshot expects `expected`. */
export interface UpullRPartsWindow {
  beginDate: string;
  endDate: string;
  expected: number;
}

/**
 * Windows from `end` back to {@link UPULLRPARTS_FIRST_DAY}, newest first,
 * tiling every day once with no gaps: consecutive days are packed while
 * their expected vehicles stay within `target`, and the oldest window runs
 * back to the first day. A day expects its count in yesterday's published
 * snapshot (`counts`); a business day on or after `unknownFrom`, which the
 * snapshot may not have seen in full, expects at least `newDayEstimate`. The
 * plan only sets cost: a window that comes back full is split.
 */
export function planUpullRPartsWindows(params: {
  end: string;
  counts: ReadonlyMap<string, number>;
  unknownFrom: string;
  newDayEstimate: number;
  target?: number;
}): UpullRPartsWindow[] {
  const target = params.target ?? UPULLRPARTS_WINDOW_TARGET;
  const expected = (day: string) =>
    Math.max(
      params.counts.get(day) ?? 0,
      day >= params.unknownFrom && UpullRPartsDay.isBusinessDay(day)
        ? params.newDayEstimate
        : 0,
    );
  // Past the oldest counted or estimated day, every day expects nothing.
  let oldest =
    params.unknownFrom < params.end ? params.unknownFrom : params.end;
  for (const day of params.counts.keys()) if (day < oldest) oldest = day;
  const windows: UpullRPartsWindow[] = [];
  let endDate = params.end;
  let sum = 0;
  for (let day = params.end; day >= oldest; day = UpullRPartsDay.add(day, -1)) {
    const count = expected(day);
    if (sum > 0 && sum + count > target) {
      windows.push({
        beginDate: UpullRPartsDay.add(day, 1),
        endDate,
        expected: sum,
      });
      endDate = day;
      sum = 0;
    }
    sum += count;
  }
  if (endDate >= UPULLRPARTS_FIRST_DAY)
    windows.push({ beginDate: UPULLRPARTS_FIRST_DAY, endDate, expected: sum });
  return windows;
}

/** A row's identity: its stock number, else its VIN. */
export function upullRPartsRowKey(record: UpullRPartsVehicle): string {
  return (
    record.StockNumber?.trim().toUpperCase() ||
    record.VIN?.trim().toUpperCase() ||
    JSON.stringify(record)
  );
}

function decode(rows: readonly unknown[]) {
  const records: UpullRPartsVehicle[] = [];
  let rejected = 0;
  for (const row of rows) {
    const parsed = Schema.decodeUnknownEither(UpullRPartsVehicleSchema)(row);
    if (Either.isLeft(parsed)) rejected += 1;
    else records.push(parsed.right);
  }
  return { records, rejected };
}

/** The accepted rows of one search, below the limit. */
export interface UpullRPartsSearchResult {
  records: UpullRPartsVehicle[];
  rejectedRows: number;
}

/**
 * The last day of the older half of a multi-day window that filled the
 * limit. A full result is the newest 100 by date, so splitting after its
 * oldest day leaves a newer half it held in full: one search, under the
 * limit, unless the site changed. The result itself is never used, so a
 * wrong guess costs a search, not a vehicle. When every row is from the
 * window's last day, that day is split off; without dates, at the middle.
 */
function splitDay(
  window: UpullRPartsWindow,
  records: readonly UpullRPartsVehicle[],
): string {
  let oldest: string | null = null;
  for (const record of records) {
    const day = UpullRPartsDay.parse(record.DateSetData);
    if (day !== null && (oldest === null || day < oldest)) oldest = day;
  }
  if (oldest !== null && oldest >= window.beginDate && oldest < window.endDate)
    return oldest;
  if (oldest === window.endDate) return UpullRPartsDay.add(window.endDate, -1);
  const span = UpullRPartsDay.between(window.beginDate, window.endDate);
  return UpullRPartsDay.add(window.beginDate, Math.floor(span / 2));
}

/** Where a location's windows stopped. */
export type UpullRPartsWindowProgress =
  /** Every window back to the first day was accepted. */
  | { status: "complete" }
  /** Every arrival after `end` was accepted; resume at `end`. */
  | { status: "paused"; end: string }
  /** Every arrival after `day` was accepted, and `day` alone filled a
   * search, so it is split by make; `sample` is that full search's rows. */
  | { status: "split"; day: string; sample: string[] };

/**
 * Searches `windows` (from {@link planUpullRPartsWindows}) newest first while
 * `mayStart` allows; the first search always runs, so every chunk makes
 * progress. A window that returns the search limit is never used: a
 * multi-day window is split in two by date (`splitDay`) and both parts
 * searched, and a single day stops the crawl for a make split. An empty
 * window may be a rejected token or a blocked IP, so the canary runs (a
 * blocked IP fails with {@link UpullRPartsSearchBlocked}) and the window is
 * searched exactly once more before it is accepted, empty or not; when
 * `mayRecheck` refuses those searches, the crawl pauses at that window
 * without accepting it.
 */
export function crawlUpullRPartsWindows<S>(options: {
  site: UpullRPartsLocation;
  windows: readonly UpullRPartsWindow[];
  search: UpullRPartsSearch<S>;
  mayStart: () => boolean;
  mayRecheck: () => boolean;
}): Effect.Effect<
  {
    results: UpullRPartsSearchResult[];
    searches: number;
    progress: UpullRPartsWindowProgress;
  },
  S | UpullRPartsSearchBlocked
> {
  return Effect.gen(function* () {
    const { site } = options;
    let searches = 0;
    const run = (beginDate: string, endDate: string) =>
      options.search({ site, beginDate, endDate, makes: "" }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            searches += 1;
          }),
        ),
      );
    const results: UpullRPartsSearchResult[] = [];
    // Newest last, so pop takes the newest window first.
    const pending = [...options.windows].reverse();
    while (true) {
      const window = pending.pop();
      if (window === undefined)
        return { results, searches, progress: { status: "complete" } };
      if (searches > 0 && !options.mayStart()) {
        return {
          results,
          searches,
          progress: { status: "paused", end: window.endDate },
        };
      }
      let rows = yield* run(window.beginDate, window.endDate);
      if (rows.length === 0) {
        if (!options.mayRecheck())
          return {
            results,
            searches,
            progress: { status: "paused", end: window.endDate },
          };
        searches += yield* checkUpullRPartsSearch(
          site,
          options.search,
          "during",
        );
        rows = yield* run(window.beginDate, window.endDate);
      }
      if (rows.length >= UPULLRPARTS_SEARCH_LIMIT) {
        if (window.beginDate === window.endDate)
          return {
            results,
            searches,
            progress: {
              status: "split",
              day: window.endDate,
              sample: decode(rows)
                .records.filter(
                  (record) => record.StockNumber?.trim() || record.VIN?.trim(),
                )
                .map(upullRPartsRowKey)
                .filter((key) => key.length <= 100),
            },
          };
        const middle = splitDay(window, decode(rows).records);
        pending.push(
          { beginDate: window.beginDate, endDate: middle, expected: 0 },
          {
            beginDate: UpullRPartsDay.add(middle, 1),
            endDate: window.endDate,
            expected: 0,
          },
        );
        continue;
      }
      const decoded = decode(rows);
      results.push({
        records: decoded.records,
        rejectedRows: decoded.rejected,
      });
    }
  });
}

/** Where a day's make split stopped: every make up to `afterMake`, in
 * label order, was searched; `missing` are the full search's rows not yet
 * found under any make. */
export interface UpullRPartsMakeSplitPoint {
  afterMake: string | null;
  missing: readonly string[];
}

/**
 * Searches `day` at one location make by make, in label order after
 * `from.afterMake`, while `mayStart` allows (the first search always runs).
 * Each make's rows carry that make. A make that still fills the search
 * limit, or a finished split that never found a row of the day's full
 * search, fails the crawl.
 */
export function crawlUpullRPartsDayByMake<S>(options: {
  site: UpullRPartsLocation;
  day: string;
  makes: readonly string[];
  from: UpullRPartsMakeSplitPoint;
  search: UpullRPartsSearch<S>;
  mayStart: () => boolean;
}): Effect.Effect<
  {
    results: (UpullRPartsSearchResult & { make: string })[];
    searches: number;
    progress:
      | { status: "complete" }
      | ({ status: "paused" } & UpullRPartsMakeSplitPoint);
  },
  S | UpullRPartsCrawlError
> {
  return Effect.gen(function* () {
    const { site, day } = options;
    const after = options.from.afterMake;
    const pending = [...new Set(options.makes)]
      .sort()
      .filter((make) => after === null || make > after);
    const missing = new Set(options.from.missing);
    const results: (UpullRPartsSearchResult & { make: string })[] = [];
    let searches = 0;
    let afterMake = after;
    for (const make of pending) {
      if (searches > 0 && !options.mayStart())
        return {
          results,
          searches,
          progress: { status: "paused", afterMake, missing: [...missing] },
        };
      const rows = yield* options.search({
        site,
        beginDate: day,
        endDate: day,
        makes: make,
      });
      searches += 1;
      if (rows.length >= UPULLRPARTS_SEARCH_LIMIT)
        return yield* new UpullRPartsCrawlError({
          message: `U Pull R Parts location ${site} arrivals on ${day} of make ${make} still returned ${UPULLRPARTS_SEARCH_LIMIT} vehicles, the search limit, so some are unreachable by date and make. No batches were emitted for this chunk and prior inventory is preserved; add a model split before retrying.`,
        });
      const decoded = decode(rows);
      for (const record of decoded.records)
        missing.delete(upullRPartsRowKey(record));
      results.push({
        make,
        records: decoded.records,
        rejectedRows: decoded.rejected,
      });
      afterMake = make;
    }
    if (missing.size > 0)
      return yield* new UpullRPartsCrawlError({
        message: `U Pull R Parts location ${site} arrivals on ${day} filled a search, and splitting them by make never found ${missing.size} of its vehicles (${[...missing].slice(0, 3).join(", ")}). A rejected token or a blocked IP returns an empty list, so a make search most likely came back empty. No batches were emitted for this chunk and prior inventory is preserved; the retry searches the day's makes again from this chunk's cursor.`,
      });
    return { results, searches, progress: { status: "complete" } };
  });
}
