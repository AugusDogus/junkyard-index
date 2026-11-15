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
  urgiisEntryFingerprint,
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

export interface UrgiisOptions<E, R> {
  startCursor?: unknown;
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
  status: "paused" | "complete";
  cursor: UrgiisCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
function parseEntry(
  raw: string,
  task: UrgiisTask,
  tenant: UrgiisTenant,
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
      seller: urgiisDetailSeller(raw, tenant),
    };
  const page = iisCards(raw, tenant);
  if (page.capped || (page.nativeEmpty && task.model.count >= 500))
    throw new Error(
      "Native 500-card boundary or empty large model reached at " +
        task.url +
        "; narrow by the published year controls before emission",
    );
  return { ...receipt, kind: "model", records: page.records };
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
    while (cursor.phase !== "complete") {
      const tenant = tenants[cursor.completed.length];
      if (!tenant)
        return yield* Effect.fail(
          urgiisError("next tenant", "Qualified tenant is missing"),
        );
      const tasks = urgiisTasks(cursor.entries, tenant);
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
        const sellers = new Map(
          cursor.entries.flatMap((entry) =>
            entry.kind === "detail" ? [[entry.url, entry.seller] as const] : [],
          ),
        );
        const snapshot = yield* boundary("snapshot " + tenant.code, () => {
          const snapshot = urgiisSnapshot(pages, tenant, sellers);
          validateUrgiisSnapshot(snapshot, tenant);
          return snapshot;
        });
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
              version: 1,
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
      if (result.pagesProcessed >= budget) break;
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
        (t) => t.kind !== "model" && t.kind !== "detail",
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
      const raw = yield* options.readPage(task.url, tenant);
      const entry = yield* boundary("parse " + task.url, () =>
        parseEntry(raw, task, tenant),
      );
      const state = cursor;
      const base = {
        ...state,
        requests: state.requests + 1,
        bytes: state.bytes + Buffer.byteLength(raw),
      };
      if (state.phase === "closing") {
        const opening = state.entries.find(
          (e) => e.url === entry.url && e.kind === entry.kind,
        );
        if (
          !opening ||
          urgiisEntryFingerprint(opening) !== urgiisEntryFingerprint(entry)
        )
          return yield* Effect.fail(
            urgiisError(
              "closing graph drift",
              "Official owner or published controls changed for " +
                tenant.code +
                "; restart this run",
            ),
          );
        cursor = yield* boundary("closing checkpoint", () =>
          UrgiisCursor.checkpoint(
            {
              ...base,
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
      result.pagesProcessed++;
    }
    return {
      ...result,
      cursor,
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
