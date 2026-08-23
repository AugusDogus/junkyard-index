import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { Effect } from "effect";
import { Database } from "./context";
import {
  loadPullapartCachedEnrichments,
  shouldRefreshPullapartEnrichment,
} from "./pullapart-enrichment-cache";
import type { PullapartVehicle } from "./pullapart-client";

function rawVehicle(
  vin: string,
  ticketID: number,
  locID: number,
): PullapartVehicle {
  return {
    vinID: ticketID,
    ticketID,
    lineID: 1,
    locID,
    locName: "Test Yard",
    makeID: 1,
    makeName: "HONDA",
    modelID: 1,
    modelName: "ACCORD",
    modelYear: 2010,
    row: 1,
    vin,
    dateYardOn: "2026-08-01T00:00:00Z",
    vinDecodedId: null,
    extendedInfo: null,
  };
}

describe("loadPullapartCachedEnrichments", () => {
  test("refreshes every VIN exactly once during a seven-day window", () => {
    const start = Date.UTC(2026, 7, 23);
    const refreshDays = Array.from({ length: 7 }, (_, dayOffset) =>
      shouldRefreshPullapartEnrichment(
        "MATCHING000000001",
        new Date(start + dayOffset * 86_400_000),
      ),
    );

    expect(refreshDays.filter(Boolean)).toHaveLength(1);
  });

  test("reuses only the same source, yard, and ticket", async () => {
    const client = createClient({ url: ":memory:" });
    const database = drizzle(client);
    await client.executeMultiple(`
      create table vehicle (
        vin text primary key,
        source text not null,
        stock_number text,
        location_code text not null,
        color text,
        image_url text,
        engine text,
        trim text,
        transmission text
      );
      insert into vehicle values
        ('MATCHING000000001', 'pullapart', '10', '3', 'Silver', 'image-1', 'V6', 'Touring', 'Automatic'),
        ('MOVED00000000002', 'pullapart', '20', '4', 'Blue', 'image-2', 'I4', 'Base', 'Manual'),
        ('OTHER00000000003', 'row52', '30', '3', 'Red', 'image-3', 'V8', 'Sport', 'Automatic');
    `);

    try {
      const nonRefreshDay = Array.from(
        { length: 7 },
        (_, dayOffset) => new Date(Date.UTC(2026, 7, 23 + dayOffset)),
      ).find(
        (date) => !shouldRefreshPullapartEnrichment("MATCHING000000001", date),
      );
      if (!nonRefreshDay) {
        throw new Error("Expected a non-refresh day for the cache fixture");
      }

      const cached = await Effect.runPromise(
        loadPullapartCachedEnrichments(
          [
            rawVehicle("MATCHING000000001", 10, 3),
            rawVehicle("MOVED00000000002", 20, 3),
            rawVehicle("OTHER00000000003", 30, 3),
          ],
          nonRefreshDay,
        ).pipe(Effect.provideService(Database, database)),
      );

      expect([...cached.keys()]).toEqual(["MATCHING000000001"]);
      expect(cached.get("MATCHING000000001")).toEqual({
        color: "Silver",
        imageUrl: "image-1",
        engine: "V6",
        trim: "Touring",
        transmission: "Automatic",
      });
    } finally {
      client.close();
    }
  });

  test("omits today's refresh cohort from cache hits", async () => {
    const client = createClient({ url: ":memory:" });
    const database = drizzle(client);
    await client.executeMultiple(`
      create table vehicle (
        vin text primary key,
        source text not null,
        stock_number text,
        location_code text not null,
        color text,
        image_url text,
        engine text,
        trim text,
        transmission text
      );
      insert into vehicle values
        ('REFRESH0000000001', 'pullapart', '10', '3', null, null, null, null, null);
    `);

    try {
      const refreshDay = Array.from(
        { length: 7 },
        (_, dayOffset) => new Date(Date.UTC(2026, 7, 23 + dayOffset)),
      ).find((date) =>
        shouldRefreshPullapartEnrichment("REFRESH0000000001", date),
      );
      if (!refreshDay) {
        throw new Error("Expected a refresh day for the cache fixture");
      }

      const cached = await Effect.runPromise(
        loadPullapartCachedEnrichments(
          [rawVehicle("REFRESH0000000001", 10, 3)],
          refreshDay,
        ).pipe(Effect.provideService(Database, database)),
      );

      expect(cached.size).toBe(0);
    } finally {
      client.close();
    }
  });
});
