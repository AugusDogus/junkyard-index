import { FetchHttpClient } from "@effect/platform";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { db } from "~/lib/db";
import { env } from "~/env";

export class Database extends Context.Tag("ingestion/Database")<
  Database,
  typeof db
>() {
  static Live = Layer.succeed(this, db);
}

interface IngestionConfig {
  betterStackHeartbeatUrl: string | undefined;
  hyperbrowserApiKey: string | undefined;
}

export class Config extends Context.Tag("ingestion/Config")<
  Config,
  IngestionConfig
>() {
  static Live = Layer.succeed(this, {
    betterStackHeartbeatUrl: env.BETTERSTACK_HEARTBEAT_URL,
    hyperbrowserApiKey: env.HYPERBROWSER_API_KEY,
  });
}

export const IngestionLayer = Layer.mergeAll(
  Database.Live,
  Config.Live,
  FetchHttpClient.layer,
);

const runtime = ManagedRuntime.make(IngestionLayer);

/**
 * Run an ingestion Effect program to a Promise.
 * Used at the boundary between Trigger.dev tasks and Effect internals.
 */
export const runIngestionEffect = <A, E>(
  effect: Effect.Effect<A, E, Layer.Layer.Success<typeof IngestionLayer>>,
): Promise<A> => runtime.runPromise(effect);
