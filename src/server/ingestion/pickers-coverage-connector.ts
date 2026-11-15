import { Effect } from "effect";
import { PickersCursor } from "./pickers-cursor";
import { PickersCoverageCursor } from "./pickers-coverage-cursor";
import {
  pickersRequestGate,
  streamPickersInventoryWithRequestGate,
} from "./pickers-connector";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { PickersCanonicalVehicle } from "./pickers-transform";
import type { PickersYard } from "./pickers-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";
import type { PickersProviderError } from "./pickers-client";

interface Options<E, R> {
  startCursor?: PickersCoverageCursor;
  maxPages?: number;
  onBatch: (vehicles: PickersCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: PickersYard[]) => Effect.Effect<void, E, R>;
}
export function streamPickersCoverageWithRequestGate<E, R>(
  options: Options<E, R>,
  gate: ProviderRequestGate,
): Effect.Effect<
  ConnectorChunkResult<"pickers", PickersCoverageCursor>,
  PickersProviderError | E,
  R
> {
  return Effect.gen(function* () {
    const cursor = PickersCoverageCursor.parse(
      PickersCoverageCursor.serialize(
        options.startCursor ?? PickersCoverageCursor.initial,
      ),
    );
    if (cursor.version === 1)
      return yield* streamPickersInventoryWithRequestGate(
        { ...options, startCursor: cursor },
        gate,
      );
    if (cursor.phase === "complete")
      return {
        source: "pickers",
        status: "complete",
        cursor,
        count: 0,
        errors: [],
        warnings: [],
        pagesProcessed: 0,
      } satisfies ConnectorChunkResult<"pickers", PickersCoverageCursor>;
    const result = yield* streamPickersInventoryWithRequestGate(
      { ...options, startCursor: cursor.cursor, siteCode: cursor.siteCode },
      gate,
    );
    const next =
      cursor.siteCode === "pickers-texarkana"
        ? "pickers-longview"
        : cursor.siteCode === "pickers-longview"
          ? "pickers-reno"
          : null;
    const updated: PickersCoverageCursor =
      result.status !== "complete"
        ? { ...cursor, cursor: result.cursor }
        : next
          ? { ...cursor, siteCode: next, cursor: PickersCursor.initial }
          : { source: "pickers", version: 2, phase: "complete" };
    return {
      ...result,
      status: updated.phase === "complete" ? "complete" : "paused",
      cursor: updated,
    } satisfies ConnectorChunkResult<"pickers", PickersCoverageCursor>;
  });
}
export function streamPickersCoverage<E, R>(options: Options<E, R>) {
  return streamPickersCoverageWithRequestGate(options, pickersRequestGate);
}
