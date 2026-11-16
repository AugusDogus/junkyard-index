import { urgiisArrivalsCoverage } from "./urgiis-arrivals";
import {
  resumeUrgiisCensus,
  type UrgiisCensusHistory,
} from "./urgiis-census-session";
import {
  UrgiisCensus,
  urgiisCarry,
  urgiisDefer,
  URGIIS_SWEEP_MS,
} from "./urgiis-census";
import { UrgiisTenant } from "./urgiis-tenant";
import { urgiisDetailSeller } from "./urgiis-detail";
import { Effect } from "effect";
import type { Yard } from "~/lib/yard";
import type { CanonicalVehicle } from "./types";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import { UrgiisCursor, URGIIS_MAX_REQUESTS } from "./urgiis-cursor";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import {
  urgiisTasks,
  urgiisFingerprint,
  type UrgiisEntry,
  type UrgiisTask,
} from "./urgiis-traversal";
import { iisCards, iisDirectory, iisDocument } from "./urgiis-catalog";
import { iisText } from "./iis-html";
import {
  urgiisSnapshot,
  validateUrgiisSnapshot,
  type UrgiisModelPage,
} from "./urgiis-snapshot";
import { readUrgiisPage, urgiisError, type UrgiisError } from "./urgiis-client";
import { urgiisClosingEvidence } from "./urgiis-closing";

export interface UrgiisOptions<E, R> extends UrgiisCensusHistory {
  startCursor?: unknown;
  now?: number;
  maxPages?: number;
  tenants?: readonly UrgiisTenant[];
  readPage: (
    url: string,
    tenant: UrgiisTenant,
  ) => Effect.Effect<string, UrgiisError>;
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
    };
  const page = iisCards(
    raw,
    tenant,
    task.kind === "arrivals" ? "arrivals" : "model",
  );
  if (
    page.capped ||
    (task.kind === "model" && page.nativeEmpty && task.model.count >= 500)
  )
    throw new Error(
      "Native 500-card boundary or empty large model reached at " +
        task.url +
        "; narrow by the published year controls before emission",
    );
  return task.kind === "model"
    ? {
        ...receipt,
        kind: "model",
        records: page.records,
        freshness: { kind: "read", readAt: now },
      }
    : { ...receipt, kind: "arrivals", records: page.records };
}
const boundary = <T>(operation: string, run: () => T) =>
  Effect.try({ try: run, catch: (cause) => urgiisError(operation, cause) });
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
    const now = options.now ?? Date.now();
    const resumed = yield* resumeUrgiisCensus(cursor, tenants, now, options);
    cursor = resumed.cursor;
    let census = resumed.census;
    result.warnings.push(...resumed.warnings);
    const startedAt = cursor.startedAt ?? now;
    let unsealed = false;
    while (cursor.phase !== "complete") {
      const tenant = tenants[cursor.completed.length];
      if (!tenant)
        return yield* Effect.fail(
          urgiisError("next tenant", "Qualified tenant is missing"),
        );
      const tasks = urgiisTasks(cursor.entries, tenant);
      const previousTenant = census.tenants.find((t) => t.code === tenant.code);
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
        const acceptedAt = options.now ?? Date.now();
        const sellers = new Map(
          cursor.entries.flatMap((entry) =>
            entry.kind === "detail" ? [[entry.url, entry.seller] as const] : [],
          ),
        );
        const snapshot = yield* boundary("snapshot " + tenant.code, () => {
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
        });
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
        const completed = [
          ...cursor.completed,
          { code: tenant.code, accepted: count },
        ];
        cursor = yield* boundary("next tenant checkpoint", () =>
          UrgiisCursor.checkpoint(
            {
              source: "urgiis",
              version: 2,
              startedAt,
              asOf: acceptedAt,
              statePath: cursor.statePath,
              stateHash: urgiisFingerprint(census),
              scope: cursor.scope,
              requests: cursor.requests,
              bytes: cursor.bytes,
              completed,
              ...(completed.length === tenants.length
                ? { phase: "complete" }
                : { phase: "opening", entries: [], closed: 0 }),
            },
            tenants,
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
      const task =
        cursor.phase === "closing"
          ? closingTasks[cursor.closed]
          : tasks[cursor.entries.length];
      if (!task)
        return yield* Effect.fail(
          urgiisError(
            "next task",
            "Contiguous native frontier has no next task",
          ),
        );
      const carried =
        cursor.phase === "opening"
          ? urgiisCarry(task, cursor.entries, previousTenant, now)
          : undefined;
      if (carried) {
        const entries = [...cursor.entries, carried];
        cursor = {
          ...cursor,
          entries,
          asOf: Math.max(now, cursor.asOf ?? now),
          phase:
            entries.length === urgiisTasks(entries, tenant).length
              ? "closing"
              : "opening",
        };
        unsealed = true;
        continue;
      }
      if (result.pagesProcessed >= budget) break;
      const response = yield* options
        .readPage(task.url, tenant)
        .pipe(Effect.either);
      if (response._tag === "Left") {
        const failedAt = options.now ?? Date.now();
        const deferred =
          cursor.phase === "opening"
            ? urgiisDefer(task, cursor.entries, previousTenant, failedAt)
            : undefined;
        if (!deferred) return yield* Effect.fail(response.left);
        const entries = [...cursor.entries, deferred];
        cursor = yield* boundary("deferred model checkpoint", () =>
          UrgiisCursor.checkpoint(
            {
              ...cursor,
              entries,
              asOf: failedAt,
              requests: cursor.requests + 1,
              phase:
                entries.length === urgiisTasks(entries, tenant).length
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
        continue;
      }
      const raw = response.right;
      const readAt = options.now ?? Date.now();
      const parsed = yield* boundary("parse " + task.url, () =>
        parseEntry(raw, task, tenant, readAt),
      ).pipe(Effect.either);
      if (parsed._tag === "Left") {
        if (cursor.phase !== "closing") return yield* Effect.fail(parsed.left);
        return {
          ...result,
          cursor,
          status: "failed" as const,
          pagesProcessed: result.pagesProcessed + 1,
          errors: [parsed.left.message],
        };
      }
      const entry = parsed.right;
      const state = cursor;
      const base = {
        ...state,
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
        // Frozen opening evidence cannot be repaired by rereading closing pages.
        // A failed result ends the durable source without workflow step retries.
        if (closing.kind === "drift")
          return {
            ...result,
            cursor,
            status: "failed" as const,
            pagesProcessed: result.pagesProcessed + 1,
            errors: [
              urgiisError(
                "closing graph drift",
                `${tenant.code}: ${closing.message}; inspect the captures and restart this run`,
              ).message,
            ],
          };
        cursor = yield* boundary("closing checkpoint", () =>
          UrgiisCursor.checkpoint(
            {
              ...base,
              badgeDrift: closing.badgeDrift,
              closed: state.closed + 1,
              phase:
                state.closed + 1 === closingTasks.length ? "ready" : "closing",
            },
            tenants,
          ),
        );
      } else {
        const entries = [...state.entries, entry];
        const nextTasks = urgiisTasks(entries, tenant);
        cursor = yield* boundary("opening checkpoint", () =>
          UrgiisCursor.checkpoint(
            {
              ...base,
              entries,
              phase:
                entries.length === nextTasks.length ? "closing" : "opening",
            },
            tenants,
          ),
        );
      }
      unsealed = false;
      result.pagesProcessed++;
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
    Effect.timeoutFail({
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
