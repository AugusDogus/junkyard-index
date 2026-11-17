import { ingestionValidation } from "./ingestion-validation";
import { Effect, RateLimiter } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import { fetchMeeksPage, MeeksProviderError } from "./meeks-client";
import { MeeksCursor, MeeksCursorSchema } from "./meeks-cursor";
import { parseMeeksInventory, parseMeeksOwner } from "./meeks-parser";
import { meeksSnapshot } from "./meeks-snapshot";
import type { MeeksCanonicalVehicle } from "./meeks-transform";
import { MEEKS_YARD } from "./meeks-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";

interface MeeksOptions<E, R> {
  startCursor?: MeeksCursor;
  maxPages?: number;
  onBatch: (vehicles: MeeksCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: (typeof MEEKS_YARD)[]) => Effect.Effect<void, E, R>;
}
export type MeeksStreamResult = ConnectorChunkResult<"meeks", MeeksCursor>;

export function streamMeeksInventoryWithRequestGate<E, R>(
  options: MeeksOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = MeeksCursorSchema.safeParse(
      options.startCursor ?? MeeksCursor.initial,
    );
    const maxPages = options.maxPages ?? 1;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    )
      return yield* new MeeksProviderError({
        operation: "checkpoint",
        cause:
          "Invalid cursor or page budget; use a Meeks start or complete cursor and a 1-32 logical catalog page budget",
      });
    const empty: MeeksStreamResult = {
      source: "meeks",
      status: "complete",
      cursor: { source: "meeks", phase: "complete" },
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
    if (parsed.data.phase === "complete") return empty;

    const ownerHtml = yield* fetchMeeksPage("/", gate);
    yield* ingestionValidation({
      try: () => parseMeeksOwner(ownerHtml),
      catch: (cause) =>
        new MeeksProviderError({
          operation: "donor-yard owner validation",
          cause,
        }),
    });
    const primaryHtml = yield* fetchMeeksPage("/pic-and-pull/", gate);
    const controlHtml = yield* fetchMeeksPage("/pic-and-pull-inventory/", gate);
    const opening = yield* ingestionValidation({
      try: () => {
        const primary = parseMeeksInventory(primaryHtml, "full");
        const consistency = parseMeeksInventory(controlHtml, "yard");
        const snapshot = meeksSnapshot(primary.records, consistency.records);
        if (!snapshot.qualityWithinExistingRatios)
          throw new Error(
            "Meeks primary inventory quality failed: " +
              snapshot.accounting.recordsRejected +
              " rejected and " +
              snapshot.accounting.duplicateVehicles +
              " duplicates of " +
              snapshot.accounting.recordsProcessed +
              " observations; retain the 10% rejection and 25% duplicate limits",
          );
        return { primary, consistency, snapshot };
      },
      catch: (cause) =>
        new MeeksProviderError({
          operation: "opening inventory validation",
          cause,
        }),
    });
    const closingPrimaryHtml = yield* fetchMeeksPage("/pic-and-pull/", gate);
    yield* ingestionValidation({
      try: () => {
        if (
          parseMeeksInventory(closingPrimaryHtml, "full").hash !==
          opening.primary.hash
        )
          throw new Error(
            "Meeks full inventory changed during the crawl; retry from the start checkpoint",
          );
      },
      catch: (cause) =>
        new MeeksProviderError({ operation: "full closing validation", cause }),
    });
    const closingControlHtml = yield* fetchMeeksPage(
      "/pic-and-pull-inventory/",
      gate,
    );
    yield* ingestionValidation({
      try: () => {
        if (
          parseMeeksInventory(closingControlHtml, "yard").hash !==
          opening.consistency.hash
        )
          throw new Error(
            "Meeks consistency inventory changed during the crawl; retry from the start checkpoint",
          );
      },
      catch: (cause) =>
        new MeeksProviderError({
          operation: "consistency closing validation",
          cause,
        }),
    });
    if (options.onYards) yield* options.onYards([MEEKS_YARD]);
    yield* options.onBatch(opening.snapshot.vehicles);
    return {
      ...empty,
      count: opening.snapshot.vehicles.length,
      pagesProcessed: 1,
      observedVins: opening.snapshot.observedVins,
      accounting: opening.snapshot.accounting,
      warnings: opening.snapshot.accounting.recordsRejected
        ? [
            "Meeks rejected " +
              opening.snapshot.accounting.recordsRejected +
              " incomplete or conflicting primary donors; valid rejected VINs provide presence evidence only.",
          ]
        : [],
    } satisfies MeeksStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "2 minutes",
      onTimeout: () =>
        new MeeksProviderError({
          operation: "catalog budget",
          cause:
            "Two-minute crawl limit exceeded; no complete checkpoint returned",
        }),
    }),
  );
}

export function streamMeeksInventory<E, R>(options: MeeksOptions<E, R>) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamMeeksInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}
