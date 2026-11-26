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
import { BoundedWork } from "../src/lib/bounded-work";
import { stateRecentArrivalRebuildStatements } from "../src/server/ingestion/state-recent-arrival";
import { InventorySnapshot } from "../src/server/inventory-snapshot";
import { YardSummaryStore } from "../src/server/yard-summary-store";

/**
 * How long a deploy waits for missing yard summaries. Filling every yard
 * (a fresh database) reads every vehicle; past this, the build goes on and
 * the next inventory refresh stores the rest.
 */
const FILL_TIMEOUT_MS = 5 * 60 * 1000;

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
    // Optional: without a summary a yard page reads the yard's vehicles
    // until the next refresh stores one, so a failure never fails the build.
    const filledAt = Date.now();
    const fill = await BoundedWork.settle(
      YardSummaryStore.fill(database, new Date()),
      FILL_TIMEOUT_MS,
    );
    const seconds = ((Date.now() - filledAt) / 1000).toFixed(1);
    if (fill.status === "done") {
      console.info(
        `[yard-summary] Stored ${fill.value.stored} missing yard summaries in ${seconds}s.`,
      );
    } else if (fill.status === "failed") {
      console.error(
        `[yard-summary] Could not store missing yard summaries after ${seconds}s; the build continues. Yards without one read their vehicles on each page render until the next inventory refresh stores it. Stored summaries and vehicle data are unchanged.`,
        fill.error,
      );
    } else {
      console.error(
        `[yard-summary] Stopped waiting for missing yard summaries after ${seconds}s; the build continues and the summaries stored so far are kept. The next inventory refresh stores the rest.`,
      );
    }
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
