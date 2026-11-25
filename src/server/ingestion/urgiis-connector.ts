import {
  urgiisBrokenModelRoute,
  urgiisModelCoverage,
} from "./urgiis-model-coverage";
import { URGIIS_EMPTY_MODEL_MINIMUM } from "./urgiis-schema";
import { ingestionValidation } from "./ingestion-validation";
import { urgiisArrivalsCoverage } from "./urgiis-arrivals";
import {
  resumeUrgiisCensus,
  type UrgiisCensusHistory,
} from "./urgiis-census-session";
import {
  UrgiisCensus,
  urgiisCarry,
  urgiisDefer,
  urgiisModelFailureStreak,
  URGIIS_MODEL_FAILURE_STREAK,
  URGIIS_SWEEP_MS,
  URGIIS_RUN_DAYS,
  urgiisCarryMs,
  URGIIS_DAY_MS,
} from "./urgiis-census";
import { UrgiisTenant } from "./urgiis-tenant";
import { urgiisDetailSeller } from "./urgiis-detail";
import { Effect, Either, Option } from "effect";
import type { Yard } from "~/lib/yard";
import type { CanonicalVehicle } from "./types";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import {
  UrgiisCursor,
  URGIIS_MAX_REQUESTS,
  URGIIS_PAGE_ATTEMPTS,
} from "./urgiis-cursor";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import {
  urgiisTasks,
  urgiisFingerprint,
  type UrgiisEntry,
  type UrgiisTask,
} from "./urgiis-traversal";
import {
  iisCards,
  iisDeclaresSupplier,
  iisDirectory,
  iisDocument,
  iisValidateModelPage,
} from "./urgiis-catalog";
import { iisText } from "./iis-html";
import {
  urgiisSnapshot,
  validateUrgiisSnapshot,
  type UrgiisModelPage,
} from "./urgiis-snapshot";
import { readUrgiisPage, urgiisError, type UrgiisError } from "./urgiis-client";
import { urgiisClosingEvidence } from "./urgiis-closing";
import {
  ProviderChunkClock,
  ProviderTurnDeferred,
} from "./provider-chunk-clock";

export interface UrgiisOptions<E, R> extends UrgiisCensusHistory {
  startCursor?: unknown;
  now?: number;
  maxPages?: number;
  tenants?: readonly UrgiisTenant[];
  /** Takes its own shared host turn; fails with `ProviderTurnDeferred`, never
   * wrapped, when the turn cannot arrive and finish within the chunk. */
  readPage: (
    url: string,
    tenant: UrgiisTenant,
  ) => Effect.Effect<string, UrgiisError | ProviderTurnDeferred>;
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: Yard[]) => Effect.Effect<void, E, R>;
}
export interface UrgiisStreamResult {
  source: "urgiis";
  status: "paused" | "complete" | "failed";
  cursor: UrgiisCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
  checkpointState?: UrgiisCensus;
}
function parseEntry(
  raw: string,
  task: UrgiisTask,
  tenant: UrgiisTenant,
  now: number,
): UrgiisEntry {
  const receipt = { url: task.url, bytes: Buffer.byteLength(raw) };
  if (task.kind === "owner") {
    const text = iisText(iisDocument(raw, tenant)).replace(/’/g, "'");
    if (!tenant.ownerClaims.every((claim) => text.includes(claim)))
      throw new Error(
        "Official yard ownership/address changed for " + tenant.code,
      );
    return {
      ...receipt,
      kind: "owner",
      identity: urgiisFingerprint(tenant.ownerClaims),
    };
  }
  if (task.kind === "makes" || task.kind === "menu")
    return {
      ...receipt,
      kind: task.kind,
      controls: iisDirectory(
        raw,
        tenant,
        task.kind === "menu" ? task.make : undefined,
      ),
    };
  if (task.kind === "detail")
    return {
      ...receipt,
      kind: "detail",
      seller: urgiisDetailSeller(raw, tenant, task),
      readAt: now,
    };
  const page = iisCards(
    raw,
    tenant,
    task.kind === "arrivals" ? "arrivals" : "model",
  );
  if (task.kind === "model") iisValidateModelPage(page, task.model, true);
  else if (page.capped)
    throw new Error(
      "IIS native 500-card arrivals boundary reached at " + task.url,
    );
  return task.kind === "model"
    ? {
        ...receipt,
        kind: "model",
        records: page.records,
        freshness: {
          kind:
            page.nativeEmpty &&
            task.model.count >= URGIIS_EMPTY_MODEL_MINIMUM &&
            !urgiisBrokenModelRoute(task.model)
              ? "retry"
              : "read",
          readAt: now,
        },
      }
    : { ...receipt, kind: "arrivals", records: page.records };
}
const boundary = <T>(operation: string, run: () => T) =>
  ingestionValidation({
    try: run,
    catch: (cause) => urgiisError(operation, cause),
  });
export function streamUrgiisInventory<E, R>(options: UrgiisOptions<E, R>) {
  return Effect.gen(function* () {
    const tenants = options.tenants ?? URGIIS_TENANTS;
    const budget = options.maxPages ?? 3;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 3)
      return yield* Effect.fail(
        urgiisError("chunk budget", "Use 1 to 3 native pages per chunk"),
      );
    let cursor = yield* boundary("checkpoint", () =>
      UrgiisCursor.parse(
        options.startCursor ?? UrgiisCursor.initial(tenants),
        tenants,
      ),
    );
    const result: UrgiisStreamResult = {
      source: "urgiis",
      status: "paused",
      cursor,
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
    if (cursor.phase === "complete")
      return { ...result, status: "complete" as const };
    const wallNow = options.now ?? Date.now();
    const resumed = yield* resumeUrgiisCensus(
      cursor,
      tenants,
      wallNow,
      options,
    );
    cursor = resumed.cursor;
    const resumedCursor = cursor;
    let census = resumed.census;
    result.warnings.push(...resumed.warnings);
    // Date every observation conservatively at the persistent run start. Carry,
    // retry and acceptance decisions use this same clock across chunk retries.
    const now = cursor.startedAt ?? wallNow;
    const startedAt = now;
    if (cursor.retryAt !== undefined && wallNow < cursor.retryAt)
      return {
        ...result,
        cursor,
        warnings: [
          ...result.warnings,
          `URG IIS provider cooldown lasts until ${new Date(cursor.retryAt).toISOString()}; no requests made.`,
        ],
      };
    // Older checkpoints without a kind keep their one-day deadline.
    const runKind = cursor.runKind ?? "incremental";
    const runDays = URGIIS_RUN_DAYS[runKind];
    const carry = urgiisCarryMs(runKind);
    if (wallNow - startedAt >= runDays * URGIIS_DAY_MS - 8 * 60_000)
      return {
        ...result,
        cursor,
        status: "failed" as const,
        errors: [
          `URG IIS census has less than one chunk left before its ${runDays === 1 ? "one-day" : `three-day ${runKind} census`} deadline; restart with fresh evidence. Prior inventory is preserved.`,
        ],
      };
    let unsealed = false;
    while (cursor.phase !== "complete") {
      const tenant = tenants[cursor.completed.length];
      if (!tenant)
        return yield* Effect.fail(
          urgiisError("next tenant", "Qualified tenant is missing"),
        );
      // A tenant's failure ends only that tenant: it emits nothing and its
      // previous inventory stays published, outside this run's floors and
      // baselines. `bytes` is the failed request's body, or null for none.
      const blockTenant = (reason: string, bytes: number | null) =>
        boundary("blocked tenant checkpoint", () =>
          UrgiisCursor.nextTenant(
            bytes === null
              ? cursor
              : {
                  ...cursor,
                  requests: cursor.requests + 1,
                  bytes: cursor.bytes + bytes,
                },
            { code: tenant.code, blocked: reason },
            tenants,
            urgiisFingerprint(census),
          ),
        ).pipe(
          Effect.map((next) => {
            cursor = next;
            unsealed = false;
            result.checkpointState = census;
            if (bytes !== null) result.pagesProcessed++;
            result.warnings.push(`${tenant.code}: ${reason}`);
          }),
        );
      const tasks = urgiisTasks(cursor.entries, tenant);
      const previousTenant =
        cursor.runKind === "cold"
          ? undefined
          : census.tenants.find((t) => t.code === tenant.code);
      if (
        cursor.phase === "opening" &&
        cursor.entries.length === tasks.findIndex((t) => t.kind === "model")
      ) {
        const coverage = urgiisArrivalsCoverage(cursor.entries, previousTenant);
        if (coverage.kind === "overflow")
          result.warnings.push(
            `${tenant.code}: arrivals window may have overflowed (${coverage.reason}); requiring a full census today. Failed model requests cannot carry old donors in this census.`,
          );
      }
      if (unsealed && cursor.phase !== "opening") {
        const sealed = yield* boundary("carried frontier checkpoint", () =>
          UrgiisCursor.checkpoint(cursor, tenants),
        );
        cursor = { ...cursor, checksum: sealed.checksum };
        unsealed = false;
      }
      if (cursor.phase === "ready") {
        const openingCoverage = urgiisModelCoverage(cursor.entries);
        const coverage = openingCoverage.blocked
          ? openingCoverage
          : urgiisModelCoverage(cursor.entries, cursor.closingModels);
        if (coverage.count)
          result.warnings.push(`${tenant.code}: ${coverage.message}.`);
        if (coverage.blocked) {
          yield* blockTenant(coverage.message, null);
          break;
        }
        const pages: UrgiisModelPage[] = [];
        cursor.entries.forEach((entry, i) => {
          const task = tasks[i];
          if (entry.kind === "model" && task?.kind === "model")
            pages.push({
              make: task.make,
              model: task.model,
              records: entry.records,
              hash: urgiisFingerprint(entry.records),
            });
        });
        const cursorEntries = cursor.entries;
        const acceptedAt = now;
        const sellers = new Map(
          cursor.entries.flatMap((entry) =>
            entry.kind === "detail" ? [[entry.url, entry.seller] as const] : [],
          ),
        );
        const assessed = yield* boundary("snapshot " + tenant.code, () => {
          const arrivals = cursorEntries.find((e) => e.kind === "arrivals");
          const snapshot = urgiisSnapshot(
            pages,
            tenant,
            sellers,
            arrivals && "records" in arrivals ? arrivals.records : [],
          );
          validateUrgiisSnapshot(snapshot, tenant);
          if (
            cursorEntries.some(
              (e) =>
                e.kind === "model" &&
                e.freshness.kind !== "read" &&
                acceptedAt - e.freshness.readAt >= URGIIS_SWEEP_MS,
            )
          )
            throw new Error(
              "IIS carried model evidence reached seven days; restore the failing page before publishing",
            );
          return snapshot;
        }).pipe(Effect.either);
        if (assessed._tag === "Left") {
          yield* blockTenant(assessed.left.message, null);
          break;
        }
        const snapshot = assessed.right;
        census = yield* boundary("accept census", () =>
          UrgiisCensus.accept(census, tenant, cursorEntries, acceptedAt),
        );
        result.checkpointState = census;
        const count = snapshot.vehicles.length;
        if (options.onYards)
          yield* options.onYards(
            UrgiisTenant.yards(tenant).map((y) => ({ ...y })),
          );
        yield* options.onBatch(snapshot.vehicles.map((v) => ({ ...v })));
        result.count += count;
        for (const k of [
          "recordsProcessed",
          "recordsExcluded",
          "recordsRejected",
          "duplicateVehicles",
        ] as const)
          result.accounting[k] += snapshot.accounting[k];
        result.observedVins.push(...snapshot.observedVins);
        result.warnings.push(
          `${tenant.yard.name}: ${count} accepted, ${snapshot.accounting.recordsRejected} rejected, ${snapshot.accounting.recordsExcluded} explicitly excluded.`,
        );
        const deferred = cursor.entries.filter(
          (e) => e.kind === "model" && e.freshness.kind === "deferred",
        ).length;
        cursor = yield* boundary("next tenant checkpoint", () =>
          UrgiisCursor.nextTenant(
            cursor,
            {
              code: tenant.code,
              accepted: count,
              ...(deferred > 0 ? { deferred } : {}),
            },
            tenants,
            urgiisFingerprint(census),
          ),
        );
        // One validated tenant per chunk, keeping callback and checkpoint sizes bounded.
        break;
      }

      if (
        cursor.requests >= URGIIS_MAX_REQUESTS ||
        cursor.bytes > 8 * 1024 * 1024 * 1024 - 4 * 1024 * 1024
      )
        return yield* Effect.fail(
          urgiisError(
            "whole-run budget",
            "Native graph incomplete at request/body limit",
          ),
        );
      const closingTasks = tasks.filter(
        (t) => t.kind === "owner" || t.kind === "makes" || t.kind === "menu",
      );
      const pendingIndex = cursor.entries.findIndex(
        (e) => e.kind === "model" && e.freshness.kind === "retry",
      );
      const nextTask =
        cursor.phase === "closing"
          ? closingTasks[cursor.closed]
          : tasks[cursor.entries.length];
      // Retry ordinary empty pages after the other model pages, before seller
      // requests or closing. Pending entries survive serialized chunk boundaries.
      const retrying =
        cursor.phase === "opening" &&
        pendingIndex >= 0 &&
        nextTask?.kind !== "model";
      const task = retrying ? tasks[pendingIndex] : nextTask;
      if (!task)
        return yield* Effect.fail(
          urgiisError(
            "next task",
            "Contiguous native frontier has no next task",
          ),
        );
      const attempt =
        (cursor.failedReads?.url === task.url
          ? cursor.failedReads.attempts
          : 0) + 1;
      // Read the same frontier page again in the next chunk, before giving up
      // on the tenant. Nothing from the failed read is kept.
      const readAgain = (failure: string, bytes: number) =>
        boundary("failed read checkpoint", () =>
          UrgiisCursor.checkpoint(
            {
              ...cursor,
              requests: cursor.requests + 1,
              bytes: cursor.bytes + bytes,
              failedReads: { url: task.url, attempts: attempt },
            },
            tenants,
          ),
        ).pipe(
          Effect.map((next) => {
            cursor = next;
            unsealed = false;
            result.pagesProcessed++;
            result.warnings.push(
              `${tenant.code}: ${failure} Reading ${task.url} again in the next chunk (attempt ${attempt + 1} of ${URGIIS_PAGE_ATTEMPTS}).`,
            );
          }),
        );
      const carried =
        cursor.phase === "opening" && !retrying
          ? urgiisCarry(task, cursor.entries, previousTenant, now, carry)
          : undefined;
      if (carried) {
        const entries = [...cursor.entries, carried];
        cursor = {
          ...cursor,
          entries,
          asOf: Math.max(now, cursor.asOf ?? now),
          phase:
            entries.length === urgiisTasks(entries, tenant).length &&
            !entries.some(
              (e) => e.kind === "model" && e.freshness.kind === "retry",
            )
              ? "closing"
              : "opening",
        };
        unsealed = true;
        continue;
      }
      if (result.pagesProcessed >= budget) break;
      // One 90-second model (with its retries) fits the chunk deadline. Do not
      // begin it after other requests have already consumed this chunk's budget.
      if (
        task.kind === "model" &&
        tenant.requestTimeoutMs > 60_000 &&
        result.pagesProcessed > 0
      )
        break;
      // A frontier model failure that completes the streak stops the tenant.
      // Later retries reread pages that already failed, so they neither add
      // to the streak nor end it.
      const endsStreak =
        task.kind === "model" &&
        !retrying &&
        urgiisModelFailureStreak(cursor.entries) + 1 >=
          URGIIS_MODEL_FAILURE_STREAK;
      const streakMessage = `${URGIIS_MODEL_FAILURE_STREAK} model pages failed in a row; stopping the tenant crawl rather than probing every page through an outage. Prior tenant inventory is preserved.`;
      // A deferred turn is not a provider failure. After this chunk advanced
      // it returns the last checkpoint; before that it escapes unwrapped and
      // defers the chunk. A failed read whose retry was deferred counts as a
      // failure only where it defers the model and carries its donors, so a
      // failing model page cannot stall the census; elsewhere, including a
      // model without carryable evidence, it defers too.
      const carriesFailedModel =
        task.kind === "model" &&
        cursor.phase === "opening" &&
        !endsStreak &&
        urgiisDefer(task, cursor.entries, previousTenant, now, carry) !==
          undefined;
      const read = yield* options.readPage(task.url, tenant).pipe(
        Effect.map(Either.right),
        Effect.catchAll((error) =>
          error instanceof ProviderTurnDeferred
            ? Effect.fail(error)
            : error.retryDeferred && !carriesFailedModel
              ? Effect.fail(error.retryDeferred)
              : Effect.succeed(Either.left(error)),
        ),
        ProviderChunkClock.unlessDeferred(cursor !== resumedCursor),
      );
      if (Option.isNone(read)) break;
      const response = read.value;
      if (response._tag === "Left") {
        const failedAt = now;
        if (
          response.left.kind === "blocked" &&
          response.left.retryAfterMs > 0
        ) {
          const retryAt =
            (options.now ?? Date.now()) + response.left.retryAfterMs;
          if (Number.isSafeInteger(retryAt)) {
            cursor = yield* boundary("provider cooldown checkpoint", () =>
              UrgiisCursor.checkpoint(
                { ...cursor, retryAt, requests: cursor.requests + 1 },
                tenants,
              ),
            );
            return {
              ...result,
              cursor,
              pagesProcessed: result.pagesProcessed + 1,
              warnings: [...result.warnings, response.left.message],
            };
          }
        }
        if (response.left.kind === "blocked") {
          yield* blockTenant(response.left.message, 0);
          break;
        }
        if (endsStreak) {
          yield* blockTenant(`${streakMessage} ${response.left.message}`, 0);
          break;
        }
        const deferred =
          cursor.phase === "opening"
            ? urgiisDefer(task, cursor.entries, previousTenant, failedAt, carry)
            : undefined;
        if (!deferred) {
          yield* attempt < URGIIS_PAGE_ATTEMPTS
            ? readAgain(response.left.message, 0)
            : blockTenant(
                `${task.url} failed in ${attempt} separate chunks. ${response.left.message}`,
                0,
              );
          break;
        }
        const entries = retrying
          ? cursor.entries.map((e, i) => (i === pendingIndex ? deferred : e))
          : [...cursor.entries, deferred];
        cursor = yield* boundary("deferred model checkpoint", () =>
          UrgiisCursor.checkpoint(
            {
              ...cursor,
              entries,
              asOf: failedAt,
              requests: cursor.requests + 1,
              failedReads: undefined,
              phase:
                entries.length === urgiisTasks(entries, tenant).length &&
                !entries.some(
                  (e) => e.kind === "model" && e.freshness.kind === "retry",
                )
                  ? "closing"
                  : "opening",
            },
            tenants,
          ),
        );
        unsealed = false;
        result.pagesProcessed++;
        result.warnings.push(
          `${tenant.code}: ${task.url} failed after retries; retaining model donors read at ${new Date(deferred.freshness.readAt).toISOString()}. Retry next run; publication stops at seven days.`,
        );
        // Persist this failed-page frontier before any further network work.
        break;
      }
      const raw = response.right;
      if (!iisDeclaresSupplier(raw, tenant) && attempt < URGIIS_PAGE_ATTEMPTS) {
        // Production saw one such page each at Linder's and Chuckran; both
        // declared their supplier on the next read. A page that still declares
        // none on the last attempt fails the supplier check below.
        yield* readAgain(
          "The page declares no supplier (var urgid), so it cannot be attributed.",
          Buffer.byteLength(raw),
        );
        break;
      }
      const readAt = now;
      // Closing can schedule this retry even when the opening badge was one.
      const parsed = yield* boundary("parse " + task.url, () =>
        parseEntry(
          raw,
          retrying && task.kind === "model"
            ? {
                ...task,
                model: {
                  ...task.model,
                  count: Math.max(task.model.count, URGIIS_EMPTY_MODEL_MINIMUM),
                },
              }
            : task,
          tenant,
          readAt,
        ),
      ).pipe(Effect.either);
      if (parsed._tag === "Left") {
        yield* blockTenant(parsed.left.message, Buffer.byteLength(raw));
        break;
      }
      let entry = parsed.right;
      if (
        endsStreak &&
        entry.kind === "model" &&
        entry.freshness.kind === "retry"
      ) {
        yield* blockTenant(
          `${streakMessage} ${task.url} returned an explicit empty result.`,
          Buffer.byteLength(raw),
        );
        break;
      }
      if (
        retrying &&
        entry.kind === "model" &&
        entry.freshness.kind === "retry"
      ) {
        const deferred = urgiisDefer(
          task,
          cursor.entries,
          previousTenant,
          now,
          carry,
        );
        if (!deferred) {
          yield* blockTenant(
            `${task.url} still returns an explicit empty result after a later retry; no eligible prior model evidence can be carried. Prior tenant inventory is preserved.`,
            Buffer.byteLength(raw),
          );
          break;
        }
        entry = deferred;
        result.warnings.push(
          `${tenant.code}: ${task.url} remains explicitly empty after a later retry; retaining donors read at ${new Date(deferred.freshness.readAt).toISOString()}. Retry next run; age bound unchanged.`,
        );
      }

      const state = cursor;
      const base = {
        ...state,
        failedReads: undefined,
        asOf: readAt,
        requests: state.requests + 1,
        bytes: state.bytes + Buffer.byteLength(raw),
      };
      if (state.phase === "closing") {
        const opening = state.entries.find(
          (e) => e.url === entry.url && e.kind === entry.kind,
        );
        const closing = urgiisClosingEvidence(
          opening,
          entry,
          state.entries,
          state.badgeDrift ?? { makes: 0, models: 0 },
        );
        // Frozen opening evidence cannot be repaired by rereading closing pages,
        // so drift blocks this tenant at once.
        if (closing.kind === "drift") {
          yield* blockTenant(
            urgiisError(
              "closing graph drift",
              `${closing.message}; inspect the captures before tomorrow's fresh tenant crawl`,
            ).message,
            Buffer.byteLength(raw),
          );
          break;
        }
        if (closing.kind === "retry") {
          const paths = new Set(
            closing.models.map((model) => tenant.origin + model.path),
          );
          const entries = state.entries
            .filter((entry) => entry.kind !== "detail")
            .map(
              (entry): UrgiisEntry =>
                entry.kind === "model" && paths.has(entry.url)
                  ? {
                      ...entry,
                      freshness: { ...entry.freshness, kind: "retry" },
                    }
                  : entry,
            );
          // Recheck every closing control after the retry. Seller tasks must be
          // derived again because recovered donors may change their order.
          cursor = yield* boundary("closing empty retry checkpoint", () =>
            UrgiisCursor.checkpoint(
              {
                ...base,
                entries,
                phase: "opening",
                closed: 0,
                badgeDrift: { makes: 0, models: 0 },
                closingModels: undefined,
              },
              tenants,
            ),
          );
          result.warnings.push(
            `${tenant.code}: ordinary empty model badges reached two during closing; retrying ${closing.models.map((model) => model.path).join(", ")} before repeating closing checks.`,
          );
          result.pagesProcessed++;
          unsealed = false;
          continue;
        }
        cursor = yield* boundary("closing checkpoint", () =>
          UrgiisCursor.checkpoint(
            {
              ...base,
              badgeDrift: closing.badgeDrift,
              closingModels:
                entry.kind === "menu"
                  ? [...(state.closingModels ?? []), ...entry.controls]
                  : state.closingModels,
              closed: state.closed + 1,
              phase:
                state.closed + 1 === closingTasks.length ? "ready" : "closing",
            },
            tenants,
          ),
        );
      } else {
        const entries = retrying
          ? state.entries.map((e, i) => (i === pendingIndex ? entry : e))
          : [...state.entries, entry];
        const nextTasks = urgiisTasks(entries, tenant);
        cursor = yield* boundary("opening checkpoint", () =>
          UrgiisCursor.checkpoint(
            {
              ...base,
              entries,
              phase:
                entries.length === nextTasks.length &&
                !entries.some(
                  (e) => e.kind === "model" && e.freshness.kind === "retry",
                )
                  ? "closing"
                  : "opening",
            },
            tenants,
          ),
        );
      }
      unsealed = false;
      result.pagesProcessed++;
      if (entry.kind === "model" && entry.freshness.kind === "deferred") break;
    }
    return {
      ...result,
      cursor: unsealed
        ? yield* boundary("chunk checkpoint", () =>
            UrgiisCursor.checkpoint(cursor, tenants),
          )
        : cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies UrgiisStreamResult;
  }).pipe(
    ProviderChunkClock.deadline({
      duration: "8 minutes",
      onTimeout: () =>
        urgiisError(
          "chunk deadline",
          "Eight-minute request/body limit exceeded",
        ),
    }),
  );
}
export function streamUrgiisInventoryFromProvider<E, R>(
  options: Omit<UrgiisOptions<E, R>, "readPage">,
) {
  return streamUrgiisInventory({ ...options, readPage: readUrgiisPage });
}
