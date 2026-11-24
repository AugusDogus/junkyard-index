import {
  ingestionValidation,
  transientRejection,
  validationRejectionKind,
} from "./ingestion-validation";
import { Effect, Option } from "effect";
import { VINPLUS_TENANTS, type VinplusTenant } from "./vinplus-configuration";
import { VinplusCursor, VINPLUS_MAX_REQUESTS } from "./vinplus-cursor";
import {
  inspectVinplusEvidence,
  VINPLUS_MAX_YARD_REQUESTS,
  type VinplusControl,
} from "./vinplus-parser";
import { readVinplusControl } from "./vinplus-client";
import { VinplusError, VINPLUS_NOT_PUBLISHED } from "./vinplus-error";
import { vinplusSnapshot } from "./vinplus-snapshot";
import type { CanonicalVehicle } from "./types";
import type { Yard } from "~/lib/yard";
import type { ConnectorChunkResult } from "./connector-chunk";
import { ProviderChunkClock } from "./provider-chunk-clock";
import { sharedProviderHostTurn } from "./shared-provider-host";

export interface VinplusOptions<E, R> {
  startCursor?: unknown;
  maxPages?: number;
  readControl?: (
    control: VinplusControl,
  ) => Effect.Effect<string, VinplusError>;
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: Yard[]) => Effect.Effect<void, E, R>;
}
export type VinplusStreamResult = ConnectorChunkResult<
  "vinplus",
  VinplusCursor
>;
/** Keeps a transient mark from the protocol, such as a stale year
 * distribution, so the source retries later the same day. */
const validated = <T>(operation: string, run: () => T) =>
  ingestionValidation({
    try: run,
    catch: (cause) => {
      const error = VinplusError.create(
        operation,
        cause instanceof Error ? cause.message : String(cause),
      );
      return validationRejectionKind(cause) === "transient"
        ? transientRejection(error)
        : error;
    },
  });
/** The rejection for a crawl that has used a request limit before its yard's
 * terminal controls, or null. A step retry would replay the same saved
 * evidence into the same limit, so it rejects the crawl as transient: a
 * refreshed distribution can reconcile large years with fewer directory
 * reads. */
export function vinplusRequestBudget(
  cursor: VinplusCursor,
  tenant: VinplusTenant,
): VinplusError | null {
  const evidence = cursor.yards.at(-1) ?? [];
  const total = cursor.yards.reduce((sum, bodies) => sum + bodies.length, 0);
  const retry = `The source retries later today, when a refreshed year distribution may need fewer make reads; if this repeats, inspect which year controls used the requests in the saved evidence before raising the limit`;
  if (total >= VINPLUS_MAX_REQUESTS)
    return transientRejection(
      VinplusError.create(
        "request budget",
        `VinPlus reached its cumulative ${VINPLUS_MAX_REQUESTS}-request limit at ${tenant.label} (${tenant.yardId}) before terminal controls, after ${cursor.yards.map((bodies, index) => `${VINPLUS_TENANTS[index]?.yardId ?? index}: ${bodies.length}`).join(", ")} requests, so ${VINPLUS_NOT_PUBLISHED}. ${retry}`,
      ),
    );
  if (evidence.length >= VINPLUS_MAX_YARD_REQUESTS)
    return transientRejection(
      VinplusError.create(
        "request budget " + tenant.yardId,
        `${tenant.label} reached its ${VINPLUS_MAX_YARD_REQUESTS}-request limit before terminal controls, most likely because large years that never reconciled with the distribution, or capped years, read most of the make directory, so ${VINPLUS_NOT_PUBLISHED}. ${retry}`,
      ),
    );
  return null;
}
export function streamVinplusInventory<E, R>(options: VinplusOptions<E, R>) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 8;
    if (!Number.isInteger(budget) || budget < 1 || budget > 16)
      return yield* Effect.fail(
        VinplusError.create("chunk budget", "Use an integer from 1 to 16"),
      );
    let cursor = yield* validated("checkpoint", () =>
      VinplusCursor.parse(options.startCursor ?? VinplusCursor.initial()),
    );
    const empty: VinplusStreamResult = {
      source: "vinplus",
      status: "paused",
      cursor,
      count: 0,
      pagesProcessed: 0,
      errors: [],
      warnings: [],
      observedVins: [],
      accounting: {
        recordsProcessed: 0,
        recordsRejected: 0,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      },
    };
    if (cursor.phase === "complete")
      return { ...empty, status: "complete" as const };
    const started = Date.now();
    let pagesProcessed = 0;
    let frontier: { index: number; control: VinplusControl } | null = null;
    while (
      cursor.phase !== "complete" &&
      pagesProcessed < budget &&
      Date.now() - started < 150_000
    ) {
      const index = cursor.yards.length - 1;
      const tenant = VINPLUS_TENANTS[index];
      const evidence = cursor.yards[index];
      if (!tenant || !evidence)
        return yield* Effect.fail(
          VinplusError.create(
            "yard scope",
            "Missing configured yard or evidence prefix",
          ),
        );
      const exhausted = vinplusRequestBudget(cursor, tenant);
      if (exhausted) return yield* Effect.fail(exhausted);
      const control = yield* validated(
        "public protocol " + tenant.yardId,
        () => {
          if (frontier?.index === index) return frontier.control;
          const progress = inspectVinplusEvidence(tenant, evidence);
          if (progress.kind !== "pending")
            throw new Error("Terminal yard did not advance");
          return progress.control;
        },
      );
      const read = yield* (options.readControl ?? readVinplusControl)(
        control,
      ).pipe(
        sharedProviderHostTurn(control.url),
        ProviderChunkClock.unlessDeferred(pagesProcessed > 0),
      );
      if (Option.isNone(read)) break;
      const raw = read.value;
      cursor = yield* validated(
        `response ${tenant.yardId} control ${evidence.length} and next checkpoint`,
        () => {
          const nextEvidence = [...evidence, raw];
          const next = inspectVinplusEvidence(tenant, nextEvidence);
          const yards = [...cursor.yards.slice(0, index), nextEvidence];
          if (next.kind === "complete") {
            vinplusSnapshot(tenant, next.records);
            if (yards.length < VINPLUS_TENANTS.length) yards.push([]);
          }
          const nextCursor: VinplusCursor = {
            ...cursor,
            phase:
              next.kind === "complete" &&
              yards.length === VINPLUS_TENANTS.length &&
              index === VINPLUS_TENANTS.length - 1
                ? "complete"
                : "collecting",
            yards,
          };
          VinplusCursor.checkCapacity(nextCursor);
          frontier =
            next.kind === "pending" ? { index, control: next.control } : null;
          return nextCursor;
        },
      );
      pagesProcessed++;
    }
    cursor = yield* validated("durable checkpoint", () =>
      VinplusCursor.checkpoint(cursor),
    );
    if (cursor.phase !== "complete")
      return { ...empty, cursor, pagesProcessed };
    const snapshots = yield* validated("terminal inventory quality", () =>
      cursor.yards.map((evidence, index) => {
        const tenant = VINPLUS_TENANTS[index];
        if (!tenant) throw new Error("Unknown terminal tenant");
        const result = inspectVinplusEvidence(tenant, evidence);
        if (result.kind !== "complete")
          throw new Error("Terminal yard still has pending controls");
        return {
          ...vinplusSnapshot(tenant, result.records),
          warnings: result.warnings,
        };
      }),
    );
    const vehicles = snapshots.flatMap((snapshot) => snapshot.vehicles);
    if (options.onYards)
      yield* options.onYards(
        VINPLUS_TENANTS.map((tenant) => ({ ...tenant.yard })),
      );
    yield* options.onBatch(vehicles);
    return {
      ...empty,
      status: "complete" as const,
      cursor,
      pagesProcessed,
      count: vehicles.length,
      warnings: snapshots.flatMap((snapshot) => snapshot.warnings),
      observedVins: snapshots.flatMap((snapshot) => snapshot.observedVins),
      accounting: snapshots.reduce(
        (sum, snapshot) => ({
          recordsProcessed:
            sum.recordsProcessed + snapshot.accounting.recordsProcessed,
          recordsRejected:
            sum.recordsRejected + snapshot.accounting.recordsRejected,
          recordsExcluded: 0,
          duplicateVehicles:
            sum.duplicateVehicles + snapshot.accounting.duplicateVehicles,
        }),
        {
          recordsProcessed: 0,
          recordsRejected: 0,
          recordsExcluded: 0,
          duplicateVehicles: 0,
        },
      ),
    } satisfies VinplusStreamResult;
  }).pipe(
    ProviderChunkClock.deadline({
      duration: "3 minutes",
      onTimeout: () =>
        VinplusError.create("chunk deadline", "Three-minute deadline exceeded"),
    }),
  );
}
