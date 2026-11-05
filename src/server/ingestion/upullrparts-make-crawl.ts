import { Data, Effect, Either, Schema } from "effect";
import {
  UpullRPartsVehicleSchema,
  type UpullRPartsProviderError,
  type UpullRPartsVehicle,
} from "./upullrparts-client";

/** getVehicles locations: Minnesota (1) covers stores 1 and 2, Toledo (3) store 3. */
export const UPULLRPARTS_LOCATIONS = ["1", "3"] as const;
export type UpullRPartsLocation = (typeof UPULLRPARTS_LOCATIONS)[number];

/** getVehicles returns at most this many rows and has no paging. */
export const UPULLRPARTS_SEARCH_LIMIT = 100;

/**
 * Searches with a date range are limited to two per IP, after which every
 * search returns an empty list. Searches by make, model, and year are not
 * limited, so the crawl never sends dates.
 */
export interface UpullRPartsSearchParams {
  site: UpullRPartsLocation;
  makes: string;
  models: string;
  years: string;
}

export type UpullRPartsSearch = (
  params: UpullRPartsSearchParams,
) => Effect.Effect<readonly unknown[], UpullRPartsProviderError>;

export class UpullRPartsCrawlError extends Data.TaggedError(
  "UpullRPartsCrawlError",
)<{ message: string }> {}

/**
 * The search IP is blocked: getVehicles accepts the Turnstile token but
 * returns an empty list for every search. A new sandbox session gets a new IP.
 */
export class UpullRPartsSearchBlockedError extends Data.TaggedError(
  "UpullRPartsSearchBlockedError",
)<{ message: string }> {}

/** Every location stocks Fords, so an empty Ford search means a blocked IP. */
const CANARY_MAKE = "Ford";

export function checkUpullRPartsSearch(
  site: UpullRPartsLocation,
  search: UpullRPartsSearch,
  when: "before" | "after",
) {
  return search({ site, makes: CANARY_MAKE, models: ANY, years: ANY }).pipe(
    Effect.flatMap((rows) =>
      rows.length > 0
        ? Effect.void
        : Effect.fail(
            new UpullRPartsSearchBlockedError({
              message: `U Pull R Parts returned no ${CANARY_MAKE} vehicles at location ${site} ${when} the crawl, so the search IP is blocked and empty results cannot be trusted. Retry with a new sandbox session; this chunk emitted no batches.`,
            }),
          ),
    ),
  );
}

export interface UpullRPartsCrawlDirectory<E> {
  models: (make: string) => Effect.Effect<readonly string[], E>;
  years: (make: string, model: string) => Effect.Effect<readonly string[], E>;
}

export interface UpullRPartsCrawledVehicle {
  record: UpullRPartsVehicle;
  /** The directory make the vehicle was found under; rows carry no make. */
  make: string;
}

export interface UpullRPartsMakeResult {
  vehicles: UpullRPartsCrawledVehicle[];
  rejectedRows: number;
  searches: number;
}

const ANY = "0";
// A rejected Turnstile token also returns an empty list, so an empty make is
// confirmed once and a split that drops a known vehicle is searched again.
const SPLIT_ATTEMPTS = 3;

function key(record: UpullRPartsVehicle): string {
  return (
    record.StockNumber?.trim().toUpperCase() ||
    record.VIN?.trim().toUpperCase() ||
    JSON.stringify(record)
  );
}

function label(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? "";
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

function describe(params: UpullRPartsSearchParams) {
  const parts = [`location ${params.site}`, params.makes];
  if (params.models !== ANY) parts.push(params.models);
  if (params.years !== ANY) parts.push(params.years);
  return parts.join(" ");
}

/**
 * Crawls one make at one location. A full page is split by model, and a full
 * model by year. Every vehicle in a full page must reappear in the split
 * search for its model or year; a split that drops one is searched again,
 * because a silently rejected token returns an empty list.
 */
export function crawlUpullRPartsMake<E>(
  site: UpullRPartsLocation,
  make: string,
  search: UpullRPartsSearch,
  directory: UpullRPartsCrawlDirectory<E>,
): Effect.Effect<
  UpullRPartsMakeResult,
  UpullRPartsProviderError | UpullRPartsCrawlError | E
> {
  return Effect.gen(function* () {
    const found = new Map<string, UpullRPartsVehicle>();
    let rejectedRows = 0;
    let searches = 0;

    const run = (params: UpullRPartsSearchParams) =>
      search(params).pipe(
        Effect.map((rows) => {
          searches += 1;
          const decoded = decode(rows);
          rejectedRows += decoded.rejected;
          for (const record of decoded.records) found.set(key(record), record);
          return { rows, records: decoded.records };
        }),
      );

    /** Searches until every expected vehicle is present. */
    const runCovering = (
      params: UpullRPartsSearchParams,
      expected: readonly UpullRPartsVehicle[],
    ) =>
      Effect.gen(function* () {
        for (let attempt = 1; ; attempt++) {
          const result = yield* run(params);
          const keys = new Set(result.records.map(key));
          const missing = expected.filter((record) => !keys.has(key(record)));
          if (missing.length === 0) return result;
          if (attempt >= SPLIT_ATTEMPTS)
            return yield* new UpullRPartsCrawlError({
              message: `U Pull R Parts ${describe(params)} omitted ${missing.length} vehicles (${missing
                .slice(0, 3)
                .map(key)
                .join(
                  ", ",
                )}) that its parent search returned, after ${SPLIT_ATTEMPTS} attempts. The search sandbox is likely receiving rejected Turnstile tokens; no batches were emitted for this make.`,
            });
        }
      });

    const base: UpullRPartsSearchParams = {
      site,
      makes: make,
      models: ANY,
      years: ANY,
    };
    let top = yield* run(base);
    if (top.rows.length === 0) top = yield* run(base);
    if (top.rows.length >= UPULLRPARTS_SEARCH_LIMIT) {
      const listed = yield* directory.models(make);
      const known = new Set(listed.map(label));
      // Rows can carry models the directory omits, such as UNKNOWN. Search
      // them by name too; the coverage check fails the make if that misses.
      const unlisted = [
        ...new Set(
          top.records
            .map((record) => record.Model?.trim() ?? "")
            .filter((model) => model !== "" && !known.has(label(model))),
        ),
      ];
      const models = [...listed, ...unlisted];
      yield* Effect.forEach(
        models,
        (model) =>
          Effect.gen(function* () {
            const params = { ...base, models: model };
            const expected = top.records.filter(
              (record) => label(record.Model) === label(model),
            );
            const byModel = yield* runCovering(params, expected);
            if (byModel.rows.length < UPULLRPARTS_SEARCH_LIMIT) return;
            const years = yield* directory.years(make, model);
            if (years.length === 0)
              return yield* new UpullRPartsCrawlError({
                message: `U Pull R Parts ${describe(params)} returned ${UPULLRPARTS_SEARCH_LIMIT} vehicles, the search limit, but getYears lists no years to split it by. Add another split before retrying.`,
              });
            yield* Effect.forEach(
              years,
              (year) =>
                Effect.gen(function* () {
                  const yearParams = { ...params, years: year };
                  const byYear = yield* runCovering(
                    yearParams,
                    byModel.records.filter(
                      (record) => String(record.Year) === year,
                    ),
                  );
                  if (byYear.rows.length >= UPULLRPARTS_SEARCH_LIMIT)
                    return yield* new UpullRPartsCrawlError({
                      message: `U Pull R Parts ${describe(yearParams)} still returned ${UPULLRPARTS_SEARCH_LIMIT} vehicles, the search limit, so some are unreachable. Add a narrower split before retrying.`,
                    });
                }),
              { concurrency: "unbounded", discard: true },
            );
          }),
        { concurrency: "unbounded", discard: true },
      );
    }
    return {
      vehicles: [...found.values()].map((record) => ({ record, make })),
      rejectedRows,
      searches,
    };
  });
}

export type UpullRPartsCrawlProgress =
  | { status: "complete" }
  | { status: "paused"; afterMake: string | null };

/**
 * Crawls makes in order, starting after `afterMake`, until the deadline.
 * Makes start in order and every started make finishes, so the crawl always
 * ends on a completed prefix that the cursor can resume after.
 */
export function crawlUpullRPartsMakes<E>(options: {
  site: UpullRPartsLocation;
  makes: readonly string[];
  afterMake: string | null;
  search: UpullRPartsSearch;
  directory: UpullRPartsCrawlDirectory<E>;
  makeConcurrency: number;
  shouldStartMake: () => boolean;
}): Effect.Effect<
  { results: UpullRPartsMakeResult[]; progress: UpullRPartsCrawlProgress },
  UpullRPartsProviderError | UpullRPartsCrawlError | E
> {
  const pending = [...options.makes]
    .sort()
    .filter((make) => options.afterMake === null || make > options.afterMake);
  const started: string[] = [];
  let stopped = false;
  return Effect.forEach(
    pending,
    (make) =>
      Effect.suspend(() => {
        // Always start one make so every chunk makes progress.
        if (stopped || (started.length > 0 && !options.shouldStartMake())) {
          stopped = true;
          return Effect.succeed(null);
        }
        started.push(make);
        return crawlUpullRPartsMake(
          options.site,
          make,
          options.search,
          options.directory,
        );
      }),
    { concurrency: options.makeConcurrency },
  ).pipe(
    Effect.map((results) => {
      const finished = results.filter(
        (result): result is UpullRPartsMakeResult => result !== null,
      );
      return {
        results: finished,
        progress:
          started.length === pending.length
            ? { status: "complete" }
            : {
                status: "paused",
                afterMake: started.at(-1) ?? options.afterMake,
              },
      };
    }),
  );
}
