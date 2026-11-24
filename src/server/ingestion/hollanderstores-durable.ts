import { Effect } from "effect";
import { HollanderstoresProviderError } from "./hollanderstores-client";
import {
  type HollanderstoresOptions,
  type HollanderstoresStreamResult,
} from "./hollanderstores-connector";
import { HollanderstoresDurableCursor } from "./hollanderstores-durable-cursor";

/** Uses the repository's checkpointState protocol, also used by AutoRecycler. */
export function streamHollanderstoresDurableInventory<E, R>(
  options: Omit<HollanderstoresOptions<E, R>, "startCursor" | "decodeBatch"> & {
    startCursor: HollanderstoresDurableCursor;
    loadState: (path: string) => Promise<unknown>;
  },
  stream: (
    options: Omit<HollanderstoresOptions<E, R>, "decodeBatch">,
  ) => Effect.Effect<
    HollanderstoresStreamResult,
    E | HollanderstoresProviderError,
    R
  >,
) {
  return Effect.gen(function* () {
    const startCursor = yield* Effect.tryPromise({
      try: () =>
        HollanderstoresDurableCursor.load(
          options.startCursor,
          options.loadState,
        ),
      catch: (cause) =>
        new HollanderstoresProviderError({
          operation: "load durable census snapshot",
          cause,
        }),
    });
    const result = yield* stream({ ...options, startCursor });
    // Report each yard that kept its previous inventory in the run's logs;
    // the durable reference lists their codes.
    if (result.status === "complete" && result.cursor.phase === "complete")
      for (const yard of result.cursor.preserved ?? [])
        yield* Effect.logWarning(
          `Hollander Stores preserved ${yard.code}'s previous inventory: ${yard.reason}`,
        );
    return {
      ...result,
      cursor: HollanderstoresDurableCursor.checkpoint(result.cursor),
      checkpointState: result.cursor,
    };
  });
}
