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
 * One getVehicles search. The crawl never sends dates: a date-range search
 * needs no make and is not needed to reach any vehicle.
 */
export interface UpullRPartsSearchParams {
  site: UpullRPartsLocation;
  makes: string;
  models: string;
  years: string;
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
)<{ site: UpullRPartsLocation; when: "before" | "after" }> {
  override get message() {
    return `U Pull R Parts getVehicles returned no ${CANARY_MAKE} vehicles at location ${this.site} ${this.when} the crawl, so it is most likely blocking this IP, which it does for over an hour after more than about 13 searches in a minute. The chunk's empty results cannot be trusted, so it emitted no batches and prior inventory is preserved.`;
  }
}

export function checkUpullRPartsSearch<S>(
  site: UpullRPartsLocation,
  search: UpullRPartsSearch<S>,
  when: "before" | "after",
) {
  return search({ site, makes: CANARY_MAKE, models: ANY, years: ANY }).pipe(
    Effect.flatMap((rows) =>
      rows.length > 0
        ? Effect.void
        : Effect.fail(new UpullRPartsSearchBlocked({ site, when })),
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

/**
 * How far a split make got. Every vehicle of models up to `model`, in label
 * order, has been emitted, and of `model` itself only the years up to `year`
 * when it is not null.
 */
export interface UpullRPartsSplitPoint {
  model: string;
  year: string | null;
}

/** A make's crawl finished, or stopped after `at` (null when it stopped
 * before emitting any vehicle of the make). */
export type UpullRPartsMakeProgress =
  | { status: "complete" }
  | { status: "paused"; at: UpullRPartsSplitPoint | null };

export interface UpullRPartsMakeResult {
  vehicles: UpullRPartsCrawledVehicle[];
  rejectedRows: number;
  searches: number;
  progress: UpullRPartsMakeProgress;
}

const ANY = "0";
// A rejected Turnstile token or a blocked IP also returns an empty list, so
// an empty make is confirmed once and a split that drops a known vehicle is
// searched again.
const SPLIT_ATTEMPTS = 3;
/** The most searches one crawl step sends: a split search and its repeats. */
export const UPULLRPARTS_MAX_STEP_SEARCHES = SPLIT_ATTEMPTS;

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

function yearLabel(record: UpullRPartsVehicle): string {
  return record.Year === null || record.Year === undefined
    ? ""
    : String(record.Year);
}

/** Whether a vehicle of `model` and `year` was emitted by `point`. */
function doneBy(
  point: UpullRPartsSplitPoint | null,
  model: string,
  year: string,
): boolean {
  if (point === null) return false;
  if (model !== point.model) return model < point.model;
  return point.year === null || year <= point.year;
}

/** Whether every vehicle of `model` was emitted by `point`. */
function modelDoneBy(point: UpullRPartsSplitPoint | null, model: string) {
  return (
    point !== null &&
    (model < point.model || (model === point.model && point.year === null))
  );
}

/** Labels in order, each with its first raw spelling for requests. "0"
 * means any model or year, so it is never a split. */
function ordered(
  values: readonly string[],
  accept: (name: string) => boolean,
): [string, string][] {
  const byLabel = new Map<string, string>();
  for (const value of values) {
    const name = label(value);
    if (name !== ANY && accept(name) && !byLabel.has(name))
      byLabel.set(name, value);
  }
  return [...byLabel].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
const anyModel = (name: string) => name !== "";
const fourDigitYear = (name: string) => /^\d{4}$/.test(name);

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

/** Decides whether the crawl starts another step. */
interface StepGate {
  mayStart(): boolean;
  /** A step emitted vehicles up to a new point. */
  advanced(): void;
}

/** The first step always runs, so every chunk makes progress; later steps
 * run while `shouldContinue` allows. */
function stepGate(shouldContinue: () => boolean): StepGate {
  let advanced = false;
  return {
    mayStart: () => !advanced || shouldContinue(),
    advanced: () => {
      advanced = true;
    },
  };
}

function crawlMake<E, S>(
  site: UpullRPartsLocation,
  make: string,
  search: UpullRPartsSearch<S>,
  directory: UpullRPartsCrawlDirectory<E>,
  after: UpullRPartsSplitPoint | null,
  gate: StepGate,
): Effect.Effect<UpullRPartsMakeResult, S | UpullRPartsCrawlError | E> {
  return Effect.gen(function* () {
    const found = new Map<string, UpullRPartsVehicle>();
    // Vehicles returned by this call's leaf searches, which are not split.
    const leafFound = new Set<string>();
    let rejectedRows = 0;
    let searches = 0;
    let until: UpullRPartsSplitPoint | null = after;

    const run = (params: UpullRPartsSearchParams) =>
      search(params).pipe(
        Effect.map((rows) => {
          searches += 1;
          const decoded = decode(rows);
          for (const record of decoded.records) found.set(key(record), record);
          return { rows, ...decoded };
        }),
      );
    type Searched = Effect.Effect.Success<ReturnType<typeof run>>;

    /** Counts a leaf search's rows once, from its accepted attempt. */
    const leaf = (result: Searched) => {
      rejectedRows += result.rejected;
      for (const record of result.records) leafFound.add(key(record));
    };

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
                )}) that its parent search returned, after ${SPLIT_ATTEMPTS} attempts. getVehicles is most likely blocking this IP after too many searches in a minute; no batches were emitted for this chunk, and its retry pauses for the block when its opening canary comes back empty.`,
            });
        }
      });

    // An earlier chunk emitted every vehicle up to `after`, even when a
    // resumed make or model is now short enough to be a leaf.
    const emitted = (complete: boolean) =>
      [...found]
        .filter(([id, record]) => {
          const model = label(record.Model);
          const year = yearLabel(record);
          return (
            !doneBy(after, model, year) &&
            (leafFound.has(id) || complete || doneBy(until, model, year))
          );
        })
        .map(([, record]) => ({ record, make }));
    const result = (
      progress: UpullRPartsMakeProgress,
    ): UpullRPartsMakeResult => ({
      vehicles: emitted(progress.status === "complete"),
      rejectedRows,
      searches,
      progress,
    });
    const complete = () => result({ status: "complete" });
    const paused = () => result({ status: "paused", at: until });

    const base: UpullRPartsSearchParams = {
      site,
      makes: make,
      models: ANY,
      years: ANY,
    };
    let top = yield* run(base);
    if (top.rows.length === 0) top = yield* run(base);
    if (top.rows.length < UPULLRPARTS_SEARCH_LIMIT) {
      leaf(top);
      gate.advanced();
      return complete();
    }

    const listed = yield* directory.models(make);
    // Rows can carry models the directory omits, such as UNKNOWN. Search
    // them by name too; the coverage check fails the make if that misses.
    const models = ordered(
      [...listed, ...top.records.map((record) => record.Model ?? "")],
      anyModel,
    );
    for (const [model, name] of models) {
      if (modelDoneBy(after, model)) continue;
      if (!gate.mayStart()) return paused();
      const params = { ...base, models: name };
      const byModel = yield* runCovering(
        params,
        top.records.filter((record) => label(record.Model) === model),
      );
      if (byModel.rows.length < UPULLRPARTS_SEARCH_LIMIT) {
        leaf(byModel);
        until = { model, year: null };
        gate.advanced();
        continue;
      }
      const listedYears = yield* directory.years(make, name);
      if (listedYears.length === 0)
        return yield* new UpullRPartsCrawlError({
          message: `U Pull R Parts ${describe(params)} returned ${UPULLRPARTS_SEARCH_LIMIT} vehicles, the search limit, but getYears lists no years to split it by. Add another split before retrying.`,
        });
      // A year in the rows but not in getYears is searched by name too.
      const years = ordered(
        [...listedYears, ...byModel.records.map(yearLabel)],
        fourDigitYear,
      );
      for (const [year] of years) {
        if (doneBy(after, model, year)) continue;
        if (!gate.mayStart()) return paused();
        const yearParams = { ...params, years: year };
        const byYear = yield* runCovering(
          yearParams,
          byModel.records.filter((record) => yearLabel(record) === year),
        );
        if (byYear.rows.length >= UPULLRPARTS_SEARCH_LIMIT)
          return yield* new UpullRPartsCrawlError({
            message: `U Pull R Parts ${describe(yearParams)} still returned ${UPULLRPARTS_SEARCH_LIMIT} vehicles, the search limit, so some are unreachable. Add a narrower split before retrying.`,
          });
        leaf(byYear);
        until = { model, year };
        gate.advanced();
      }
      until = { model, year: null };
    }
    return complete();
  });
}

/**
 * Crawls one make at one location. A full page is split by model, and a full
 * model by year, in label order. Every vehicle in a full page must reappear
 * in the split search for its model or year; a split that drops one is
 * searched again, because a rejected token or blocked IP returns an empty
 * list. With `after`, the crawl resumes a split make past that point and
 * emits only vehicles it had not emitted; it pauses before a step that
 * `shouldContinue` refuses, once a step has emitted vehicles.
 */
export function crawlUpullRPartsMake<E, S>(
  site: UpullRPartsLocation,
  make: string,
  search: UpullRPartsSearch<S>,
  directory: UpullRPartsCrawlDirectory<E>,
  options: {
    after: UpullRPartsSplitPoint | null;
    shouldContinue: () => boolean;
  } = { after: null, shouldContinue: () => true },
): Effect.Effect<UpullRPartsMakeResult, S | UpullRPartsCrawlError | E> {
  return crawlMake(
    site,
    make,
    search,
    directory,
    options.after,
    stepGate(options.shouldContinue),
  );
}

/** Where a location's crawl resumes: after a finished make (null before the
 * first), or inside a split make. */
export type UpullRPartsResumePoint =
  | { phase: "crawl"; afterMake: string | null }
  | ({ phase: "split"; make: string } & UpullRPartsSplitPoint);

export type UpullRPartsCrawlProgress =
  | { status: "complete" }
  | { status: "paused"; resume: UpullRPartsResumePoint };

/**
 * Crawls makes in order from `resume` while `shouldContinue` allows another
 * step, one search at a time. The first step always runs, so every chunk makes
 * progress, and the crawl stops between steps on a point the cursor can
 * resume from.
 */
export function crawlUpullRPartsMakes<E, S>(options: {
  site: UpullRPartsLocation;
  makes: readonly string[];
  resume: UpullRPartsResumePoint;
  search: UpullRPartsSearch<S>;
  directory: UpullRPartsCrawlDirectory<E>;
  shouldContinue: () => boolean;
}): Effect.Effect<
  { results: UpullRPartsMakeResult[]; progress: UpullRPartsCrawlProgress },
  S | UpullRPartsCrawlError | E
> {
  return Effect.gen(function* () {
    const { resume } = options;
    const boundary = resume.phase === "split" ? resume.make : resume.afterMake;
    const pending = [...options.makes]
      .sort()
      .filter((make) => boundary === null || make > boundary);
    // A split make resumes first, even if the directory no longer lists it.
    if (resume.phase === "split") pending.unshift(resume.make);
    const gate = stepGate(options.shouldContinue);
    const results: UpullRPartsMakeResult[] = [];
    let afterMake = resume.phase === "split" ? null : resume.afterMake;
    for (const make of pending) {
      const after =
        resume.phase === "split" && make === resume.make
          ? { model: resume.model, year: resume.year }
          : null;
      if (after === null && !gate.mayStart())
        return {
          results,
          progress: { status: "paused", resume: { phase: "crawl", afterMake } },
        };
      const result = yield* crawlMake(
        options.site,
        make,
        options.search,
        options.directory,
        after,
        gate,
      );
      results.push(result);
      if (result.progress.status === "paused") {
        const at = result.progress.at;
        return {
          results,
          progress: {
            status: "paused",
            resume:
              at === null
                ? { phase: "crawl", afterMake }
                : { phase: "split", make, ...at },
          },
        };
      }
      afterMake = make;
    }
    return { results, progress: { status: "complete" } };
  });
}
