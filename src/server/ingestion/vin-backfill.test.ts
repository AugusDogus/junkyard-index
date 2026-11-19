import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { vehicle } from "~/schema";
import { RECONCILIATION_TEST_SCHEMA } from "./durable-reconciliation-test-fixtures";
import { makeVehicle } from "./durable-ingestion-test-fixtures";
import { backfillVinVehicles } from "./vin-backfill";
import { mapDbVehicleToAlgolia } from "./algolia-projector-helpers";

const canonical = { make: "Ford", model: "F-150", year: 2006, trim: "XLT" };

test("backfill publishes canonical facets while preserving source names, trim, identity and lifecycle timestamps", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
    const database = drizzle(client);
    const raw = {
      ...makeVehicle("1FTPW14506KD19655"),
      year: 2006,
      make: "FORD",
      model: "TFORD150",
      trim: "King Ranch",
      firstSeenAt: new Date(1000),
      lastSeenAt: new Date(2000),
      observedArrivalAt: new Date(3000),
      missingSinceAt: new Date(4000),
      missingRunCount: 2,
    };
    await database.insert(vehicle).values(raw);
    const rows = await database.select().from(vehicle);
    const result = await backfillVinVehicles(database, rows, {
      decode: async (requests) =>
        new Map(requests.map((row) => [row.key, canonical])),
    });
    expect(result[0]).toMatchObject({
      ...raw,
      make: "Ford",
      model: "F-150",
      sourceMake: "FORD",
      sourceModel: "TFORD150",
    });
    const stored = result[0];
    if (!stored) throw new Error("Missing backfilled vehicle");
    const record = mapDbVehicleToAlgolia(stored);
    expect(record.model).toBe("F-150");
    expect(record.sourceModel).toBe("TFORD150");
    expect(record.searchTokens).toContain("tford150");
  } finally {
    client.close();
  }
});

test("a concurrent ingestion update wins over a stale backfill read and is the projected record", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
    const database = drizzle(client);
    const raw = {
      ...makeVehicle("1FTPW14506KD19655"),
      year: 2006,
      make: "FORD",
      model: "TFORD150",
      firstSeenAt: new Date(1000),
      lastSeenAt: new Date(2000),
    };
    await database.insert(vehicle).values(raw);
    const rows = await database.select().from(vehicle);
    const result = await backfillVinVehicles(database, rows, {
      decode: async (requests) => {
        await database
          .update(vehicle)
          .set({
            year: 2007,
            make: "Honda",
            model: "Civic",
            lastSeenAt: new Date(5000),
          })
          .where(eq(vehicle.vin, raw.vin));
        return new Map(requests.map((row) => [row.key, canonical]));
      },
    });
    expect(result[0]).toMatchObject({
      year: 2007,
      make: "Honda",
      model: "Civic",
      lastSeenAt: new Date(5000),
      sourceModel: null,
    });
  } finally {
    client.close();
  }
});
