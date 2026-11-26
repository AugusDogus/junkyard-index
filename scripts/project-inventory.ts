/**
 * Stores the inventory snapshot that inventory pages read, when this database
 * lacks it, and then rebuilds the recent arrivals state pages count. Also
 * stores a page summary for every yard that has none. Deploys run this after
 * migrating, so pages never have to compute any of them themselves; the
 * ingestion pass keeps them current after that.
 *
 * Usage: bun run inventory:project [--force]
 * --force recomputes both even when the snapshot is present. Reads every
 * vehicle once. It does not revalidate Next's caches; pages show the result
 * after the next ingestion refresh or the caches' daily expiry.
 */
import { createClient } from "@libsql/client/web";
import { drizzle } from "drizzle-orm/libsql/web";
import { stateRecentArrivalRebuildStatements } from "../src/server/ingestion/state-recent-arrival";
import { InventorySnapshot } from "../src/server/inventory-snapshot";
import { YardSummaryStore } from "../src/server/yard-summary-store";

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
    const filledAt = Date.now();
    const { stored } = await YardSummaryStore.fill(database, new Date());
    console.info(
      `[yard-summary] Stored ${stored} missing yard summaries in ${((Date.now() - filledAt) / 1000).toFixed(1)}s.`,
    );
    const startedAt = Date.now();
    const result = force
      ? await InventorySnapshot.project(database, new Date()).then(
          () => "projected" as const,
        )
      : await InventorySnapshot.ensure(database, new Date());
    if (result === "current") {
      console.info("[inventory-snapshot] Already stored; nothing to compute.");
      return;
    }
    console.info(
      `[inventory-snapshot] Stored in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`,
    );
    const rebuiltAt = Date.now();
    await client.batch(stateRecentArrivalRebuildStatements(rebuiltAt), "write");
    console.info(
      `[state-recent-arrival] Rebuilt in ${((Date.now() - rebuiltAt) / 1000).toFixed(1)}s.`,
    );
  } finally {
    client.close();
  }
}

if (import.meta.main) {
  await projectInventory(process.argv.includes("--force"));
}
