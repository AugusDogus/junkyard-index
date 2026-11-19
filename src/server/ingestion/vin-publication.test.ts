import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { vehicle } from "~/schema";
import { RECONCILIATION_TEST_SCHEMA } from "./durable-reconciliation-test-fixtures";
import { makeVehicle } from "./durable-ingestion-test-fixtures";
import { createVpicClient } from "./vpic-client";
import { runVinCachePass } from "./vin-cache-pass";
import { warmVinCacheBatch } from "./vin-cache-warmer";
import { backfillVinVehicles } from "./vin-backfill";

test("an outage opens the pass circuit and adds zero network time to publication", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
    const database = drizzle(client);
    const rows = Array.from({ length: 200 }, (_, i) => ({
      ...makeVehicle(`1FT${String(i).padStart(5, "0")}06K123456`),
      year: 2006,
      make: "FORD",
      model: "TFORD150",
      firstSeenAt: new Date(1000),
      lastSeenAt: new Date(1000),
    }));
    await database.insert(vehicle).values(rows);
    let elapsed = 0;
    let calls = 0;
    const decoder = createVpicClient({
      sleep: async (ms) => {
        elapsed += ms;
      },
      fetch: async () => {
        calls++;
        elapsed += 8000;
        throw new Error("simulated vPIC timeout");
      },
    });
    let steps = 0;
    const result = await runVinCachePass(async (state) => {
      steps++;
      return warmVinCacheBatch(database, state, decoder);
    });
    expect(result.status).toBe("unavailable");
    expect(steps).toBe(1);
    expect(calls).toBe(3);
    expect(elapsed).toBe(31000);
    const beforePublication = elapsed;
    const stored = await database.select().from(vehicle);
    for (let i = 0; i < stored.length; i += 100) {
      const projected = await backfillVinVehicles(
        database,
        stored.slice(i, i + 100),
      );
      expect(
        projected.every(
          (row) => row.make === "Ford" && row.model === "TFORD150",
        ),
      ).toBe(true);
    }
    expect(elapsed - beforePublication).toBe(0);
    expect(calls).toBe(3);
  } finally {
    client.close();
  }
});
