import { ingestionValidation } from "./ingestion-validation";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import { Effect } from "effect";
import { BudgetCursor } from "./budget-cursor";
import { BudgetProviderError, readBudgetPage } from "./budget-client";
import { parseBudgetPage } from "./budget-parser";
import {
  BUDGET_YARD,
  budgetPageUrl,
  type BudgetYard,
} from "./budget-yard-metadata";
import {
  budgetSnapshot,
  validateBudgetSnapshot,
  type BudgetCanonicalVehicle,
} from "./budget-transform";
const attempt = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new BudgetProviderError(operation, cause),
  });
export interface BudgetStreamResult {
  source: "budget";
  status: "paused" | "complete";
  cursor: BudgetCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
export interface BudgetOptions<E, R> {
  startCursor?: unknown;
  maxPages?: number;
  readPage?: (url: string) => Effect.Effect<string, BudgetProviderError>;
  onBatch: (vehicles: BudgetCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: BudgetYard[]) => Effect.Effect<void, E, R>;
}
export function streamBudgetInventory<E, R>(options: BudgetOptions<E, R>) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 8;
    if (!Number.isInteger(budget) || budget < 1 || budget > 8)
      return yield* Effect.fail(
        new BudgetProviderError(
          "chunk budget",
          "Use 1 through 8 native requests",
        ),
      );
    let cursor = yield* attempt("checkpoint", () =>
      BudgetCursor.parse(options.startCursor ?? BudgetCursor.initial()),
    );
    const summary: Omit<BudgetStreamResult, "cursor" | "status"> = {
      source: "budget",
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
    const read = options.readPage ?? readBudgetPage;
    while (cursor.phase !== "complete" && summary.pagesProcessed < budget) {
      const current = cursor;
      const index =
        current.phase === "directory"
          ? 0
          : current.phase === "opening"
            ? current.pages.length
            : current.closed;
      const make =
        current.phase === "directory" || index === 0
          ? ""
          : current.pages[0]?.makes[index - 1];
      if (make === undefined)
        return yield* Effect.fail(
          new BudgetProviderError(
            "native make prefix",
            "Next directory make is absent",
          ),
        );
      const raw = yield* read(budgetPageUrl(make));
      summary.pagesProcessed++;
      const page = yield* attempt("native make " + make, () =>
        parseBudgetPage(raw, make),
      );
      if (current.phase === "directory")
        cursor = yield* attempt("directory", () =>
          BudgetCursor.checkpoint({
            ...current,
            phase: "opening",
            pages: [page],
            closed: 0,
          }),
        );
      else if (current.phase === "opening")
        cursor = yield* attempt("opening make " + make, () => {
          const pages = [...current.pages, page];
          return BudgetCursor.checkpoint({
            ...current,
            pages,
            phase:
              pages.length === (pages[0]?.makes.length ?? 0) + 1
                ? "closing"
                : "opening",
          });
        });
      else {
        yield* attempt("closing make " + make, () => {
          if (JSON.stringify(page) !== JSON.stringify(current.pages[index]))
            throw new Error(
              "Budget closing census changed directory, donor fields, order or multiplicities",
            );
        });
        const closed = current.closed + 1;
        if (closed === current.pages.length) {
          const snapshot = yield* attempt("complete inventory", () => {
            const directory = current.pages[0];
            if (!directory)
              throw new Error("Budget complete census has no native directory");
            for (const page of current.pages.slice(1)) {
              const observed = new Set(
                page.records.map((record) => record.model),
              );
              if (
                directory.models[page.make]?.some(
                  (model) => !observed.has(model),
                )
              )
                throw new Error(
                  "Budget census did not recover every published model for " +
                    page.make,
                );
            }
            const result = budgetSnapshot(
              current.pages.flatMap((p) => p.records),
            );
            validateBudgetSnapshot(result);
            return result;
          });
          if (options.onYards) yield* options.onYards([{ ...BUDGET_YARD }]);
          yield* options.onBatch(snapshot.vehicles);
          summary.count = snapshot.vehicles.length;
          summary.accounting = snapshot.accounting;
          summary.observedVins = snapshot.observedVins;
          cursor = BudgetCursor.checkpoint({
            source: current.source,
            version: current.version,
            scope: current.scope,
            phase: "complete",
          });
        } else
          cursor = yield* attempt("closing checkpoint", () =>
            BudgetCursor.checkpoint({ ...current, closed }),
          );
      }
    }
    return {
      ...summary,
      cursor,
      status:
        cursor.phase === "complete"
          ? ("complete" as const)
          : ("paused" as const),
    };
  }).pipe(
    Effect.timeoutFail({
      duration: "4 minutes",
      onTimeout: () =>
        new BudgetProviderError(
          "chunk deadline",
          "Four-minute budget exceeded; retain prior checkpoint",
        ),
    }),
  );
}
