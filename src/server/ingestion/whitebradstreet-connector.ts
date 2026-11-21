import { ingestionValidation } from "./ingestion-validation";
import { createHash } from "node:crypto";
import { Effect, RateLimiter } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";
import type { TruckPartsCatalogPage } from "./truck-parts-catalog";
import {
  fetchWhitebradstreetControl,
  fetchWhitebradstreetPage,
  WhitebradstreetProviderError,
  WhitebradstreetRateLimitedError,
  WhitebradstreetRateLimitExhaustedError,
} from "./whitebradstreet-client";
import {
  WHITEBRADSTREET_MAX_DEFERRAL_MS,
  WHITEBRADSTREET_RATE_LIMIT_COOLDOWNS_MS,
  WhitebradstreetCursor,
  WhitebradstreetCursorSchema,
  type WhitebradstreetRateLimit,
  type WhitebradstreetSeen,
} from "./whitebradstreet-cursor";
import {
  transformWhitebradstreetRecord,
  type WhitebradstreetCanonicalVehicle,
} from "./whitebradstreet-transform";
import {
  WHITEBRADSTREET_YARD,
  type WhitebradstreetYard,
} from "./whitebradstreet-yard-metadata";

interface WhitebradstreetOptions<E, R> {
  startCursor?: WhitebradstreetCursor;
  maxPages?: number;
  onBatch: (
    vehicles: WhitebradstreetCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: WhitebradstreetYard[]) => Effect.Effect<void, E, R>;
}
export type WhitebradstreetStreamResult = ConnectorChunkResult<
  "whitebradstreet",
  WhitebradstreetCursor
>;
interface Progress {
  total: number;
  processed: number;
  emitted: number;
  rejected: number;
  duplicates: number;
  seen: WhitebradstreetSeen[];
  hashes: string[];
}
const fresh = (): Progress => ({
  total: 0,
  processed: 0,
  emitted: 0,
  rejected: 0,
  duplicates: 0,
  seen: [],
  hashes: [],
});
const failure = (operation: string, cause: unknown) =>
  Effect.fail(new WhitebradstreetProviderError({ operation, cause }));

/** The ledger covers all native rows, including rejected presence-only donors. */
function append(
  progress: Progress,
  page: TruckPartsCatalogPage,
): WhitebradstreetCanonicalVehicle[] {
  if (
    page.page !== progress.hashes.length + 1 ||
    (progress.total !== 0 && page.total !== progress.total)
  )
    throw new Error(
      "Native page order or advertised total changed during traversal",
    );
  progress.total = page.total;
  const ids = new Set(progress.seen.map((row) => row.id));
  const identities = new Map(
    progress.seen.flatMap((row) =>
      row.status === "available" ? [[row.vin, row.identity] as const] : [],
    ),
  );
  const vehicles: WhitebradstreetCanonicalVehicle[] = [];
  for (const record of page.records) {
    if (ids.has(record.id))
      throw new Error(
        "Native donor " +
          record.id +
          " repeated across pages; inventory moved during traversal",
      );
    ids.add(record.id);
    const result = transformWhitebradstreetRecord(record);
    if (result.status === "incomplete") {
      progress.seen.push({
        id: record.id,
        status: "incomplete",
        vin: result.vin,
        identity: null,
      });
      progress.rejected++;
    } else {
      const vehicle = result.vehicle;
      const identity = createHash("sha256")
        .update(
          JSON.stringify([
            vehicle.year,
            vehicle.make.toUpperCase(),
            vehicle.model.toUpperCase(),
          ]),
        )
        .digest("hex");
      const prior = identities.get(vehicle.vin);
      if (prior !== undefined && prior !== identity)
        throw new Error(
          "Canonical VIN " +
            vehicle.vin +
            " has conflicting native year, make or model",
        );
      if (prior !== undefined) {
        progress.seen.push({
          id: record.id,
          status: "duplicate",
          vin: vehicle.vin,
          identity,
        });
        progress.duplicates++;
      } else {
        identities.set(vehicle.vin, identity);
        progress.seen.push({
          id: record.id,
          status: "available",
          vin: vehicle.vin,
          identity,
        });
        progress.emitted++;
        vehicles.push(vehicle);
      }
    }
    progress.processed++;
  }
  progress.hashes.push(page.hash);
  // The fixed native total lets us reject irrecoverable cumulative quality
  // failures even before the terminal page. Chunk boundaries cannot reset it.
  if (
    progress.rejected / progress.total >
    SourceValidationPolicy.maximumRejectionRatio
  )
    throw new Error(
      "Cumulative required-field rejects exceed the unchanged 10% rejection limit",
    );
  if (
    progress.duplicates / progress.total >
    SourceValidationPolicy.maximumDuplicateRatio
  )
    throw new Error(
      "Cumulative canonical duplicates exceed the unchanged 25% duplicate limit",
    );
  return vehicles;
}

/** Schedule the durable wait for a rate-limited request. Cooldowns are
 * bounded in count and in total time, so a source cannot defer forever. */
function rateLimitCooldown(
  prior: WhitebradstreetRateLimit | undefined,
  refusal: WhitebradstreetRateLimitedError,
) {
  return ingestionValidation({
    try: () => {
      const deferrals = (prior?.deferrals ?? 0) + 1;
      const cooldownMs = WHITEBRADSTREET_RATE_LIMIT_COOLDOWNS_MS[deferrals - 1];
      const now = Date.now();
      const since = prior?.since ?? now;
      const exhausted = (bound: "cooldowns" | "window") =>
        new WhitebradstreetRateLimitExhaustedError({
          url: refusal.url,
          retryAfterMs: refusal.retryAfterMs,
          bound,
          since,
        });
      if (cooldownMs === undefined) throw exhausted("cooldowns");
      const retryAt = now + Math.max(cooldownMs, refusal.retryAfterMs);
      if (
        !Number.isSafeInteger(retryAt) ||
        retryAt > since + WHITEBRADSTREET_MAX_DEFERRAL_MS
      )
        throw exhausted("window");
      return { rateLimit: { since, deferrals }, retryAt };
    },
    catch: (cause) =>
      cause instanceof WhitebradstreetRateLimitExhaustedError
        ? cause
        : new WhitebradstreetProviderError({
            operation: "rate-limit cooldown",
            cause,
          }),
  });
}

/** A terminal chunk is at most the page budget plus the control and a 16-page
 * recheck, about 25 paced reads or 100 seconds. The chunk limit leaves 30
 * seconds after the crawl for the batch and yard callbacks. */
const CRAWL_DEADLINE = "270 seconds";
/** How early a step may start against the Workflow's sleep before it waits. */
const RETRY_AT_CLOCK_SKEW_MS = 10_000;

export function streamWhitebradstreetInventoryWithRequestGate<E, R>(
  options: WhitebradstreetOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = WhitebradstreetCursorSchema.safeParse(
      options.startCursor ?? WhitebradstreetCursor.initial,
    );
    const maxPages = options.maxPages ?? 8;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    )
      return yield* failure(
        "checkpoint",
        "Use a validated White & Bradstreet cursor and a budget of 1-32 new catalog pages",
      );
    const cursor = parsed.data;
    const empty: WhitebradstreetStreamResult = {
      source: "whitebradstreet",
      status: "complete",
      cursor: { source: "whitebradstreet", phase: "complete" },
      count: 0,
      pagesProcessed: 0,
      errors: [],
      warnings: [],
      observedVins: [],
      accounting: {
        recordsProcessed: 0,
        recordsExcluded: 0,
        recordsRejected: 0,
        duplicateVehicles: 0,
      },
    };
    if (cursor.phase === "complete") return empty;
    // The durable Workflow sleeps until retryAt; never request before it. A
    // wake within clock skew of retryAt waits out the rest, because returning
    // the unchanged cursor would fail the run as making no progress.
    if (cursor.retryAt !== undefined) {
      const remainingMs = cursor.retryAt - Date.now();
      if (remainingMs > RETRY_AT_CLOCK_SKEW_MS)
        return {
          ...empty,
          status: "paused",
          cursor,
        } satisfies WhitebradstreetStreamResult;
      if (remainingMs > 0) yield* Effect.sleep(remainingMs);
    }
    // A resumed ledger was validated when it was checkpointed and its schema
    // cross-checks coverage and counters. Rows shifted by later arrivals or
    // removals change a page hash, which the terminal recheck rejects.
    const progress: Progress =
      cursor.phase === "pages"
        ? {
            total: cursor.total,
            processed: cursor.processed,
            emitted: cursor.emitted,
            rejected: cursor.rejected,
            duplicates: cursor.duplicates,
            seen: [...cursor.seen],
            hashes: [...cursor.hashes],
          }
        : fresh();
    // The first chunk already fetched the active-donor control.
    let controlValidated = cursor.phase !== "start";
    // Set once every page is accounted for. nextPage is the first page the
    // terminal recheck has not yet confirmed.
    let recheck: { total: number; hashes: string[]; nextPage: number } | null =
      cursor.phase === "recheck"
        ? {
            total: cursor.total,
            hashes: cursor.hashes,
            nextPage: cursor.nextRecheckPage,
          }
        : null;
    let lastRateLimit: { url: string; retryAfterMs: number } | null = null;
    const onRateLimited = (url: string, retryAfterMs: number) => {
      lastRateLimit = { url, retryAfterMs };
    };
    const consume = (page: TruckPartsCatalogPage) =>
      ingestionValidation({
        try: () => append(progress, page),
        catch: (cause) =>
          new WhitebradstreetProviderError({
            operation: "page " + page.page + " accounting",
            cause,
          }),
      });
    const control = (page: TruckPartsCatalogPage) =>
      Effect.gen(function* () {
        if (controlValidated) return;
        const record = page.records.find(
          (row) => transformWhitebradstreetRecord(row).status === "available",
        );
        if (!record)
          return yield* failure(
            "active donor control",
            "First native page has no complete donor for a source-linked Now Wrecking detail control",
          );
        yield* fetchWhitebradstreetControl(record, gate, onRateLimited);
        controlValidated = true;
      });
    const before = {
      processed: progress.processed,
      rejected: progress.rejected,
      duplicates: progress.duplicates,
    };
    const vehicles: WhitebradstreetCanonicalVehicle[] = [];
    const seenStart = progress.seen.length;
    let pagesProcessed = 0;
    const crawl = Effect.gen(function* () {
      if (recheck === null) {
        let terminal = false;
        while (pagesProcessed < maxPages && !terminal) {
          const page = yield* fetchWhitebradstreetPage(
            progress.hashes.length + 1,
            gate,
            onRateLimited,
          );
          yield* control(page);
          vehicles.push(...(yield* consume(page)));
          pagesProcessed++;
          terminal = page.nextUrl === null;
        }
        if (!terminal) return;
        if (progress.processed !== progress.total || progress.emitted === 0)
          return yield* failure(
            "terminal catalog",
            "Native terminal row count differs from its advertised total or no complete donors remain",
          );
        recheck = {
          total: progress.total,
          hashes: progress.hashes,
          nextPage: 1,
        };
      }
      // Recheck every page at completion so an in-flight reorder, arrival,
      // removal or optional metadata change cannot silently qualify a mixed
      // catalog snapshot. A rate limit checkpoints the confirmed pages.
      for (; recheck.nextPage <= recheck.hashes.length; recheck.nextPage++) {
        const page = yield* fetchWhitebradstreetPage(
          recheck.nextPage,
          gate,
          onRateLimited,
        );
        if (
          page.total !== recheck.total ||
          page.hash !== recheck.hashes[recheck.nextPage - 1]
        )
          return yield* failure(
            "terminal page " + recheck.nextPage,
            "Native catalog changed during enumeration; restart from the initial cursor",
          );
      }
    }).pipe(
      // In-chunk HTTP 429 waits can use up the crawl. That still defers, so a
      // step retry never replays page 1 at a host that is rate-limiting.
      Effect.timeoutFail({
        duration: CRAWL_DEADLINE,
        onTimeout: () =>
          lastRateLimit === null
            ? new WhitebradstreetProviderError({
                operation: "crawl budget",
                cause:
                  "Crawl deadline exceeded without an HTTP 429; retain the last validated checkpoint",
              })
            : new WhitebradstreetRateLimitedError({
                ...lastRateLimit,
                reason: "chunk-deadline",
              }),
      }),
    );
    // Callbacks run only once a cursor that covers their pages is validated.
    const emit = (next: WhitebradstreetCursor, warnings: string[]) =>
      Effect.gen(function* () {
        if (vehicles.length > 0) yield* options.onBatch(vehicles);
        const rejected = progress.rejected - before.rejected;
        return {
          ...empty,
          status: next.phase === "complete" ? "complete" : "paused",
          cursor: next,
          count: vehicles.length,
          pagesProcessed,
          observedVins: [
            ...new Set(
              progress.seen
                .slice(seenStart)
                .flatMap((row) =>
                  row.status === "incomplete" && row.vin ? [row.vin] : [],
                ),
            ),
          ],
          warnings: rejected
            ? [
                ...warnings,
                "White & Bradstreet rejected " +
                  rejected +
                  " required-field-incomplete donors; valid native VINs supply presence evidence only.",
              ]
            : warnings,
          accounting: {
            recordsProcessed: progress.processed - before.processed,
            recordsExcluded: 0,
            recordsRejected: rejected,
            duplicateVehicles: progress.duplicates - before.duplicates,
          },
        } satisfies WhitebradstreetStreamResult;
      });
    const refusal = yield* crawl.pipe(
      Effect.as(null),
      Effect.catchTag("WhitebradstreetRateLimitedError", (error) =>
        Effect.succeed(error),
      ),
    );
    const rechecking = recheck;
    const advanced =
      rechecking === null
        ? ({
            source: "whitebradstreet",
            phase: "pages",
            nextPage: progress.hashes.length + 1,
            ...progress,
            ...(cursor.rateLimit === undefined
              ? {}
              : { rateLimit: cursor.rateLimit }),
          } as const)
        : ({
            source: "whitebradstreet",
            phase: "recheck",
            nextRecheckPage: rechecking.nextPage,
            total: rechecking.total,
            hashes: rechecking.hashes,
          } as const);
    if (refusal !== null) {
      const cooldown = yield* rateLimitCooldown(cursor.rateLimit, refusal);
      const warnings = [
        refusal.message +
          " Cooldown " +
          cooldown.rateLimit.deferrals +
          " of " +
          WHITEBRADSTREET_RATE_LIMIT_COOLDOWNS_MS.length +
          " lasts until " +
          new Date(cooldown.retryAt).toISOString() +
          ".",
      ];
      // Keep this chunk's new pages, or its confirmed recheck pages, so the
      // cooldown resumes where the refusal stopped. Otherwise the input
      // cursor repeats the refused request after the cooldown.
      const kept =
        pagesProcessed > 0 || rechecking !== null
          ? WhitebradstreetCursorSchema.safeParse({ ...advanced, ...cooldown })
          : null;
      if (!kept?.success) {
        const retained = WhitebradstreetCursorSchema.safeParse({
          ...cursor,
          ...cooldown,
        });
        if (!retained.success)
          return yield* failure("rate-limit checkpoint", retained.error);
        return {
          ...empty,
          status: "paused",
          cursor: retained.data,
          warnings,
        } satisfies WhitebradstreetStreamResult;
      }
      return yield* emit(kept.data, warnings);
    }
    // Without a refusal, a started recheck has confirmed every page.
    const terminal = rechecking !== null;
    const nextCursor: WhitebradstreetCursor = terminal
      ? { source: "whitebradstreet", phase: "complete" }
      : advanced;
    const validatedCursor = WhitebradstreetCursorSchema.safeParse(nextCursor);
    if (!validatedCursor.success)
      return yield* failure("checkpoint accounting", validatedCursor.error);
    if (terminal && options.onYards)
      yield* options.onYards([WHITEBRADSTREET_YARD]);
    return yield* emit(validatedCursor.data, []);
  }).pipe(
    Effect.timeoutFail({
      duration: "5 minutes",
      onTimeout: () =>
        new WhitebradstreetProviderError({
          operation: "crawl budget",
          cause:
            "Five-minute chunk limit exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}

export function streamWhitebradstreetInventory<E, R>(
  options: WhitebradstreetOptions<E, R>,
) {
  // Production reads 1.6 seconds apart drew Cloudflare HTTP 429 by page 5-9.
  // Sequential reads four seconds apart completed every live page.
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "4 seconds" }).pipe(
      Effect.flatMap((gate) =>
        streamWhitebradstreetInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}
