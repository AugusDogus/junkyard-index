import { Clock, Effect } from "effect";
import { ingestionValidation } from "./ingestion-validation";
import {
  ShopifyYardProviderError,
  shopifyYardReader,
} from "./shopify-yard-client";
import { shopifyYardHash } from "./shopify-yard-cursor";
import type { ShopifyYardOptions } from "./shopify-yard-connector";
import { SpartanCursor, spartanNextPage } from "./spartan-cursor";
import { SpartanPage } from "./spartan-parser";
import { SpartanOwner } from "./spartan-owner";
import { spartanSnapshot } from "./spartan-snapshot";
import {
  SPARTAN_OWNER,
  SPARTAN_YARD,
  spartanPageUrl,
} from "./spartan-yard-metadata";

// Transport rules are platform-independent: exact URLs, bounded responses,
// manual redirects, typed failures and a serialized twelve-second gap.
const destinations = new Map<string, "text/html" | "application/json">([
  [SPARTAN_OWNER, "text/html"],
]);
for (const kind of ["auto", "truck"] as const)
  for (let page = 1; page <= 200; page++)
    destinations.set(spartanPageUrl(kind, page), "application/json");
const readPage = shopifyYardReader("spartan", destinations);

export function streamSpartanInventory<E, R>(
  options: ShopifyYardOptions<E, R>,
) {
  const checked = <A>(operation: string, run: () => A) =>
    ingestionValidation({
      try: run,
      catch: (cause) =>
        new ShopifyYardProviderError("spartan", operation, cause),
    });
  return Effect.gen(function* () {
    const deadline = (yield* Clock.currentTimeMillis) + 180_000;
    const budget = options.maxPages ?? 4;
    if (
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > 4 ||
      (options.previousUniqueInventory !== null &&
        (!Number.isSafeInteger(options.previousUniqueInventory) ||
          options.previousUniqueInventory < 0))
    )
      return yield* Effect.fail(
        new ShopifyYardProviderError(
          "spartan",
          "options",
          "Use an integer GET budget from 1 through 4",
        ),
      );
    let cursor = yield* checked("checkpoint", () =>
      SpartanCursor.parse(options.startCursor ?? SpartanCursor.initial()),
    );
    let pagesProcessed = 0;
    let result: ReturnType<typeof spartanSnapshot> = {
      vehicles: [],
      observedVins: [],
      accounting: {
        recordsProcessed: 0,
        recordsExcluded: 0,
        recordsRejected: 0,
        duplicateVehicles: 0,
      },
    };
    while (cursor.phase !== "complete" && pagesProcessed < budget) {
      const current = cursor;
      const now = yield* Clock.currentTimeMillis;
      if (
        current.phase !== "owner" &&
        (now < current.startedAt ||
          now - current.startedAt > 2 * 60 * 60 * 1000)
      )
        return yield* Effect.fail(
          new ShopifyYardProviderError(
            "spartan",
            "census lifetime",
            "Two-hour source census expired; restart both complete passes",
          ),
        );
      const target =
        current.phase === "opening"
          ? spartanNextPage(current.pages)
          : current.phase === "closing"
            ? current.pages[current.closed]
            : null;
      const raw = yield* (options.readPage ?? readPage)(
        target ? spartanPageUrl(target.kind, target.page) : SPARTAN_OWNER,
        { deadline },
      );
      pagesProcessed++;
      if (current.phase === "owner") {
        yield* checked("opening owner", () => SpartanOwner.parse(raw));
        cursor = SpartanCursor.checkpoint({
          phase: "opening",
          startedAt: now,
          pages: [],
        });
      } else if (current.phase === "opening") {
        cursor = yield* checked("opening page", () => {
          if (!target) throw new Error("Spartan opening frontier is missing");
          const page = SpartanPage.parse(raw, target.kind, target.page);
          const pages = [...current.pages, page];
          return SpartanCursor.checkpoint(
            spartanNextPage(pages)
              ? { phase: "opening", startedAt: current.startedAt, pages }
              : {
                  phase: "closing",
                  startedAt: current.startedAt,
                  pages,
                  closed: 0,
                },
          );
        });
      } else if (current.phase === "closing") {
        cursor = yield* checked("closing page", () => {
          if (!target) throw new Error("Spartan closing frontier is missing");
          const page = SpartanPage.parse(raw, target.kind, target.page);
          if (shopifyYardHash(page) !== shopifyYardHash(target))
            throw new Error(
              "Spartan closing donor claims changed; restart both complete passes before publishing",
            );
          const closed = current.closed + 1;
          return SpartanCursor.checkpoint(
            closed === current.pages.length
              ? {
                  phase: "owner-closing",
                  startedAt: current.startedAt,
                  pages: current.pages,
                }
              : {
                  phase: "closing",
                  startedAt: current.startedAt,
                  pages: current.pages,
                  closed,
                },
          );
        });
      } else {
        const staged = yield* checked("closing owner and quality", () => {
          SpartanOwner.parse(raw);
          return spartanSnapshot(
            current.pages,
            options.previousUniqueInventory,
          );
        });
        yield* options.onBatch(staged.vehicles);
        if (options.onYards) yield* options.onYards([SPARTAN_YARD]);
        result = staged;
        cursor = SpartanCursor.checkpoint({ phase: "complete" });
      }
    }
    return {
      source: "spartan" as const,
      status:
        cursor.phase === "complete"
          ? ("complete" as const)
          : ("paused" as const),
      cursor,
      count: result.vehicles.length,
      pagesProcessed,
      accounting: result.accounting,
      observedVins: result.observedVins,
      errors: [],
      warnings: [],
    };
  });
}
