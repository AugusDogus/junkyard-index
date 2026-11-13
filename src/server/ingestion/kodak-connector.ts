import { Effect, RateLimiter } from "effect";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import { fetchKodakPage, KodakProviderError } from "./kodak-client";
import { KodakCursor, KodakCursorSchema } from "./kodak-cursor";
import { parseKodakInventory, parseKodakOwnership } from "./kodak-parser";
import { kodakSnapshot, validateKodakSnapshot } from "./kodak-snapshot";
import type { KodakCanonicalVehicle } from "./kodak-transform";
import {
  KODAK_HOME,
  KODAK_INVENTORY,
  KODAK_YARD,
  type KodakYard,
} from "./kodak-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";

interface KodakOptions<E, R> {
  startCursor?: KodakCursor;
  maxPages?: number;
  onBatch: (vehicles: KodakCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: KodakYard[]) => Effect.Effect<void, E, R>;
}
export interface KodakStreamResult {
  source: "kodak";
  status: "paused" | "complete";
  cursor: KodakCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
const attempt = <A>(operation: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) => new KodakProviderError({ operation, cause }),
  });

/** One unit is one serial GET. The atomic roster emits only after ownership,
 * every native card and all quality guards pass. No partial donor checkpoint.
 */
export function streamKodakInventoryWithRequestGate<E, R>(
  options: KodakOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = KodakCursorSchema.safeParse(
      options.startCursor ?? KodakCursor.initial,
    );
    const budget = options.maxPages ?? 2;
    if (
      !parsed.success ||
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > 2
    )
      return yield* new KodakProviderError({
        operation: "checkpoint",
        cause: "Use a validated Kodak cursor and 1-2 serial request units",
      });
    let cursor: KodakCursor = parsed.data;
    let pagesProcessed = 0;
    let count = 0;
    let observedVins: string[] = [];
    let accounting: ConnectorChunkAccounting = {
      recordsProcessed: 0,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    while (cursor.phase !== "complete" && pagesProcessed < budget) {
      if (cursor.phase === "start") {
        const html = yield* fetchKodakPage(KODAK_HOME, gate);
        const ownership = yield* attempt("native yard ownership", () =>
          parseKodakOwnership(html),
        );
        cursor = { source: "kodak", version: 1, phase: "inventory", ownership };
      } else {
        const html = yield* fetchKodakPage(KODAK_INVENTORY, gate);
        const snapshot = yield* attempt("complete donor roster", () => {
          const value = kodakSnapshot(parseKodakInventory(html));
          validateKodakSnapshot(value);
          return value;
        });
        if (options.onYards) yield* options.onYards([{ ...KODAK_YARD }]);
        yield* options.onBatch(snapshot.vehicles);
        count = snapshot.vehicles.length;
        accounting = snapshot.accounting;
        observedVins = snapshot.observedVins;
        cursor = { source: "kodak", version: 1, phase: "complete" };
      }
      pagesProcessed++;
    }
    return {
      source: "kodak",
      status: cursor.phase === "complete" ? "complete" : "paused",
      cursor,
      count,
      pagesProcessed,
      errors: [],
      warnings: accounting.recordsRejected
        ? [
            "Kodak rejected incomplete or conflicting native donors. Valid rejected VINs are retained as presence only.",
          ]
        : [],
      observedVins,
      accounting,
    } satisfies KodakStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "90 seconds",
      onTimeout: () =>
        new KodakProviderError({
          operation: "chunk",
          cause: "Ninety-second bounded request budget exceeded",
        }),
    }),
  );
}

export function streamKodakInventory<E, R>(options: KodakOptions<E, R>) {
  return Effect.scoped(
    Effect.gen(function* () {
      const limit = yield* RateLimiter.make({
        limit: 1,
        interval: "1600 millis",
      });
      const gate: ProviderRequestGate = (request) =>
        limit(request).pipe(Effect.ensuring(Effect.sleep("1600 millis")));
      return yield* streamKodakInventoryWithRequestGate(options, gate);
    }),
  );
}
