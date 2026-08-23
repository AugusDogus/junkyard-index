import { Effect, Layer, ManagedRuntime } from "effect";
import { db } from "~/lib/db";
import { env } from "~/env";
import { Config, Database } from "./context";

export { Config, Database } from "./context";

const DatabaseLive = Layer.succeed(Database, db);
const ConfigLive = Layer.succeed(Config, {
  betterStackHeartbeatUrl: env.BETTERSTACK_HEARTBEAT_URL,
  hyperbrowserApiKey: env.HYPERBROWSER_API_KEY,
});

export const IngestionLayer = Layer.mergeAll(DatabaseLive, ConfigLive);

const runtime = ManagedRuntime.make(IngestionLayer);

/**
 * Run an ingestion Effect program to a Promise.
 * Used at the boundary between workflow steps and Effect internals.
 */
export const runIngestionEffect = <A, E>(
  effect: Effect.Effect<A, E, Layer.Layer.Success<typeof IngestionLayer>>,
): Promise<A> => runtime.runPromise(effect);
