/**
 * Stores the inventory snapshot that inventory pages read, when this database
 * lacks it. Deploys run this after migrating, so pages never have to compute
 * it themselves; the ingestion pass keeps it current after that.
 *
 * Usage: bun run inventory:project [--force]
 * --force recomputes it even when present. Reads every vehicle once. It does
 * not revalidate Next's caches; pages show it after the next ingestion
 * refresh or the caches' daily expiry.
 */
import { createClient } from "@libsql/client/web";
import { drizzle } from "drizzle-orm/libsql/web";
import { InventorySnapshot } from "../src/server/inventory-snapshot";

function requiredEnvironment(
  name: "TURSO_DATABASE_URL" | "TURSO_AUTH_TOKEN",
): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required to store the inventory snapshot. Set it to the target database's credentials (bun loads .env.local, the dev database, by default) and retry.`,
    );
  }
  return value;
}

export async function projectInventory(force: boolean): Promise<void> {
  const client = createClient({
    url: requiredEnvironment("TURSO_DATABASE_URL"),
    authToken: requiredEnvironment("TURSO_AUTH_TOKEN"),
  });
  try {
    const database = drizzle(client);
    const startedAt = Date.now();
    const result = force
      ? await InventorySnapshot.project(database, new Date()).then(
          () => "projected" as const,
        )
      : await InventorySnapshot.ensure(database, new Date());
    console.info(
      result === "current"
        ? "[inventory-snapshot] Already stored; nothing to compute."
        : `[inventory-snapshot] Stored in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`,
    );
  } finally {
    client.close();
  }
}

if (import.meta.main) {
  await projectInventory(process.argv.includes("--force"));
}
