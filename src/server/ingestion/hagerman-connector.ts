import { Effect } from "effect";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import {
  fetchHagermanPage,
  HAGERMAN_MAX_RESPONSE_BYTES,
  HagermanProviderError,
  hagermanRequestGate,
  hagermanValidated,
} from "./hagerman-client";
import {
  HagermanCursor,
  HagermanCursorSchema,
  HAGERMAN_MAX_RUN_BYTES,
  HAGERMAN_MAX_RUN_MS,
} from "./hagerman-cursor";
import { HagermanCensus, hagermanPageHash } from "./hagerman-catalog";
import {
  HAGERMAN_CATALOG_URL,
  HAGERMAN_PROFILE_URL,
  HagermanCatalog,
  HagermanDonor,
  HagermanProfile,
} from "./hagerman-parser";
import {
  transformHagermanDonor,
  type HagermanCanonicalVehicle,
} from "./hagerman-transform";
import {
  HAGERMAN_COORDINATES,
  HagermanCoordinatesSchema,
  HagermanYard,
  type HagermanCoordinates,
} from "./hagerman-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";

interface HagermanOptions<E, R> {
  startCursor?: HagermanCursor;
  /** Native GET budget, including operator identity and closing verification. */
  maxPages?: number;
  yardCoordinates?: HagermanCoordinates;
  previousAcceptedCount?: number | null;
  onBatch: (vehicles: HagermanCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: HagermanYard[]) => Effect.Effect<void, E, R>;
}
export interface HagermanStreamResult {
  source: "hagerman";
  status: "paused" | "complete";
  cursor: HagermanCursor;
  count: number;
  pagesProcessed: number;
  accounting: ConnectorChunkAccounting;
  errors: string[];
  warnings: string[];
  observedVins: string[];
}

export function streamHagermanInventoryWithRequestGate<E, R>(
  options: HagermanOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const maxPages = options.maxPages ?? 12;
    const settings = yield* hagermanValidated("options", () => {
      if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 32)
        throw new Error("Use an integer native GET budget from 1 through 32");
      const previous = options.previousAcceptedCount ?? null;
      if (
        previous !== null &&
        (!Number.isSafeInteger(previous) || previous < 0)
      )
        throw new Error(
          "Previous accepted count must be a nonnegative integer or null",
        );
      return {
        coordinates: HagermanCoordinatesSchema.parse(
          options.yardCoordinates ?? HAGERMAN_COORDINATES,
        ),
        previous,
      };
    });
    let cursor: HagermanCursor = yield* hagermanValidated("checkpoint", () =>
      HagermanCursorSchema.parse(options.startCursor ?? HagermanCursor.initial),
    );
    if (cursor.phase !== "start") {
      const saved = cursor;
      yield* hagermanValidated("resume settings", () => {
        if (
          (options.yardCoordinates !== undefined &&
            JSON.stringify(settings.coordinates) !==
              JSON.stringify(saved.coordinates)) ||
          (options.previousAcceptedCount !== undefined &&
            settings.previous !== saved.previousAcceptedCount)
        )
          throw new Error(
            "Resume coordinates or previous accepted count contradict the checkpoint; retain the original run settings",
          );
      });
    }
    const result: HagermanStreamResult = {
      source: "hagerman",
      status: "paused",
      cursor,
      count: 0,
      pagesProcessed: 0,
      accounting: {
        recordsProcessed: 0,
        recordsExcluded: 0,
        recordsRejected: 0,
        duplicateVehicles: 0,
      },
      errors: [],
      warnings: [],
      observedVins: [],
    };
    const started = Date.now();
    while (cursor.phase !== "complete") {
      const current: HagermanCursor = cursor;
      yield* hagermanValidated("run bounds", () => {
        if (
          current.phase !== "start" &&
          (Date.now() < current.startedAt ||
            Date.now() - current.startedAt > HAGERMAN_MAX_RUN_MS)
        )
          throw new Error(
            "One-hour Hagerman source run deadline expired; restart the complete census before publishing",
          );
      });
      if (current.phase === "ready") {
        const staged = yield* hagermanValidated(
          "complete census quality",
          () => {
            const quality = HagermanCensus.quality(
              current.opening,
              current.donors,
              current.previousAcceptedCount,
            );
            return {
              quality,
              vehicles: quality.accepted.map((record) =>
                transformHagermanDonor(record, current.coordinates),
              ),
              next: HagermanCursorSchema.parse({
                ...current,
                phase: "complete",
              }),
            };
          },
        );
        // No vehicle or yard callback occurs until all primary and closing proofs pass.
        // A failed callback leaves the caller's prior checkpoint unchanged.
        yield* options.onBatch(staged.vehicles);
        if (options.onYards)
          yield* options.onYards([HagermanYard.create(current.coordinates)]);
        cursor = staged.next;
        result.count = staged.vehicles.length;
        result.accounting.recordsProcessed = current.opening.total;
        result.accounting.recordsRejected = staged.quality.rejected;
        result.observedVins = [
          ...new Set(
            staged.quality.records.flatMap((record) =>
              record.vin ? [record.vin] : [],
            ),
          ),
        ];
        if (staged.quality.rejected)
          result.warnings.push(
            "Hagerman rejected incomplete donor rows; independently valid rejected VINs remain presence evidence only.",
          );
        continue;
      }
      if (result.pagesProcessed >= maxPages || Date.now() - started >= 60_000)
        break;
      const url = yield* hagermanValidated("native continuation", () => {
        if (
          current.phase !== "start" &&
          current.bytes > HAGERMAN_MAX_RUN_BYTES - HAGERMAN_MAX_RESPONSE_BYTES
        )
          throw new Error(
            "Hagerman source run cannot reserve another complete bounded response; retain the prior checkpoint",
          );
        if (current.phase === "start" || current.phase === "identity-closing")
          return HAGERMAN_PROFILE_URL;
        if (current.phase === "opening" || current.phase === "closing")
          return HAGERMAN_CATALOG_URL;
        const member = current.opening.members[current.donors.length];
        if (!member)
          throw new Error("Hagerman next ordered primary detail is absent");
        return member.url;
      });
      const raw = yield* fetchHagermanPage(url, gate);
      cursor = yield* hagermanValidated(
        "native " + current.phase,
        (): HagermanCursor => {
          const bytes =
            (current.phase === "start" ? 0 : current.bytes) +
            Buffer.byteLength(raw);
          if (current.phase === "start")
            return HagermanCursorSchema.parse({
              source: "hagerman",
              version: 1,
              phase: "opening",
              startedAt: Date.now(),
              bytes,
              coordinates: settings.coordinates,
              previousAcceptedCount: settings.previous,
              profile: HagermanProfile.parse(raw),
            });
          if (current.phase === "opening")
            return HagermanCursorSchema.parse({
              ...current,
              bytes,
              phase: "details",
              opening: HagermanCatalog.parse(raw),
              donors: [],
            });
          if (current.phase === "details") {
            const member = current.opening.members[current.donors.length];
            if (!member)
              throw new Error("Hagerman assessment has no opening member");
            const donors = [
              ...current.donors,
              HagermanDonor.parse(raw, member),
            ];
            return HagermanCursorSchema.parse({
              ...current,
              bytes,
              donors,
              phase:
                donors.length === current.opening.total ? "closing" : "details",
            });
          }
          if (current.phase === "closing")
            return HagermanCursorSchema.parse({
              ...current,
              bytes,
              phase: "identity-closing",
              closing: hagermanPageHash(HagermanCatalog.parse(raw)),
            });
          return HagermanCursorSchema.parse({
            ...current,
            bytes,
            phase: "ready",
            closingProfile: HagermanProfile.parse(raw),
          });
        },
      );
      result.pagesProcessed++;
    }
    return {
      ...result,
      cursor,
      status:
        cursor.phase === "complete"
          ? ("complete" as const)
          : ("paused" as const),
    };
  }).pipe(
    Effect.timeoutFail({
      duration: "90 seconds",
      onTimeout: () =>
        new HagermanProviderError({
          operation: "chunk deadline",
          cause:
            "90-second chunk deadline exceeded; retain the prior validated checkpoint",
        }),
    }),
  );
}

export function streamHagermanInventory<E, R>(options: HagermanOptions<E, R>) {
  return streamHagermanInventoryWithRequestGate(options, hagermanRequestGate);
}
