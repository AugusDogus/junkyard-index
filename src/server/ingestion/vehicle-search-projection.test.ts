import { expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import { yard, vehicle, yardArrivalBaseline } from "~/schema";
import { projectSearchVehicles } from "./vehicle-search-projection";
import {
  CURRENT_SEARCH_SCHEMA_VERSION,
  ARRIVAL_DATE_SEARCH_SCHEMA_VERSION,
  YARD_SERVICE_SEARCH_SCHEMA_VERSION,
  NUMERIC_PRECISION_SEARCH_SCHEMA_VERSION,
} from "~/lib/search-index-schema";

/** The yard metadata and arrival baseline tables projection reads. */
async function createProjectionTables(client: Client) {
  await client.executeMultiple(
    readFileSync(
      new URL("../../../drizzle/0007_yard_metadata.sql", import.meta.url),
      "utf8",
    ),
  );
  await client.executeMultiple(`
    create table vehicle (vin text primary key, source text not null,
      location_code text not null);
  `);
  await client.executeMultiple(
    readFileSync(
      new URL(
        "../../../drizzle/0017_observed_vehicle_arrival.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}

const legacy: typeof vehicle.$inferSelect = {
  vin: "YV1LS55A9X1567408",
  source: "pullapart",
  year: 1999,
  make: "Volvo",
  model: "S70",
  sourceMake: null,
  sourceModel: null,
  color: null,
  stockNumber: null,
  imageUrl: null,
  availableDate: null,
  locationCode: "5",
  locationName: "Birmingham",
  locationCity: "Birmingham",
  state: "Alabama",
  stateAbbr: "AL",
  lat: 33.5,
  lng: -86.8,
  section: null,
  row: null,
  space: null,
  detailsUrl: null,
  partsUrl: null,
  pricesUrl: null,
  engine: null,
  trim: null,
  transmission: null,
  observedArrivalAt: null,
  firstSeenAt: new Date("2026-11-01"),
  lastSeenAt: new Date("2026-11-18"),
  missingSinceAt: null,
  missingRunCount: 0,
};

test("source cleanup reprojects stored rows and search tokens without changing identity or dates", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await createProjectionTables(client);
    const rows = [
      {
        ...legacy,
        source: "row52",
        make: "Nissian",
        model: "NISSIAN SENTRA",
        engine: "1.589545208L",
        locationName: "KIKER'S U PULL IT",
        availableDate: "2014-02-01",
      },
      {
        ...legacy,
        source: "pratt",
        make: "Ford",
        model: "FORD F150 PICKUP",
        year: 2012,
      },
      {
        ...legacy,
        source: "row52",
        make: "Toyota",
        model: "TOYOTA TACOMA",
        year: 1990,
      },
    ];
    const records = await projectSearchVehicles(drizzle(client), rows);
    expect(records[0]).toMatchObject({
      objectID: legacy.vin,
      make: "Nissan",
      model: "SENTRA",
      engine: "1.6L",
      locationName: "Kiker's U Pull It",
      availableDate: "2014-02-01",
    });
    expect(records[0]?.searchTokens).toContain("nissan");
    expect(records[0]?.searchTokens).not.toContain("nissian");
    expect(records[1]).toMatchObject({
      make: "Ford",
      model: "F-150",
      year: 2012,
    });
    expect(records[2]).toMatchObject({
      make: "Toyota",
      model: "TACOMA",
      year: 1990,
    });
    expect(CURRENT_SEARCH_SCHEMA_VERSION).toBeGreaterThan(
      NUMERIC_PRECISION_SEARCH_SCHEMA_VERSION,
    );
    expect(rows[0]?.make).toBe("Nissian");
  } finally {
    client.close();
  }
});

test("existing rows are reprojected with the yard page's authoritative operator name", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await createProjectionTables(client);
    const database = drizzle(client);
    await database.insert(yard).values([
      {
        source: "pullapart",
        code: "5",
        name: "Pull-A-Part - Birmingham",
        operator: "Pull-A-Part",
        city: "Birmingham",
        state: "AL",
        updatedAt: new Date(),
      },
      {
        source: "pullapart",
        code: "38",
        name: "U-Pull-&-Pay - Colorado Springs",
        operator: "U-Pull-&-Pay",
        city: "Colorado Springs",
        state: "CO",
        updatedAt: new Date(),
      },
      {
        source: "row52",
        code: "5",
        name: "Another Yard",
        city: "Birmingham",
        state: "AL",
        updatedAt: new Date(),
      },
    ]);
    const records = await projectSearchVehicles(database, [
      legacy,
      {
        ...legacy,
        vin: "COLORADO",
        locationCode: "38",
        locationName: "Colorado Springs",
      },
      {
        ...legacy,
        vin: "LEGACY",
        locationCode: "39",
        locationName: "Aurora",
        detailsUrl: "https://www.upullandpay.com/inventory/search/",
      },
      { ...legacy, vin: "OTHER", source: "row52" },
    ]);
    expect(records.map((r) => r.locationName)).toEqual([
      "Pull-A-Part - Birmingham",
      "U-Pull-&-Pay - Colorado Springs",
      "U-Pull-&-Pay - Aurora",
      "Another Yard",
    ]);
    expect(records[0]?.objectID).toBe(legacy.vin);
    expect(legacy.locationName).toBe("Birmingham");
    expect(CURRENT_SEARCH_SCHEMA_VERSION).toBeGreaterThan(
      ARRIVAL_DATE_SEARCH_SCHEMA_VERSION,
    );
  } finally {
    client.close();
  }
});

test("schema 7 projects each yard service type and the matching filter options", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await createProjectionTables(client);
    const records = await projectSearchVehicles(drizzle(client), [
      { ...legacy, source: "pyp" },
      { ...legacy, source: "importapart" },
      { ...legacy, source: "ipullupull" },
      { ...legacy, source: "row52", locationCode: "unreviewed" },
    ]);
    expect(CURRENT_SEARCH_SCHEMA_VERSION).toBeGreaterThanOrEqual(
      YARD_SERVICE_SEARCH_SCHEMA_VERSION,
    );
    expect(
      records.map(({ yardServiceType, yardTypes }) => ({
        yardServiceType,
        yardTypes,
      })),
    ).toEqual([
      { yardServiceType: "self_service", yardTypes: ["self_service"] },
      { yardServiceType: "full_service", yardTypes: ["full_service"] },
      { yardServiceType: "both", yardTypes: ["self_service", "full_service"] },
      { yardServiceType: "unknown", yardTypes: [] },
    ]);
  } finally {
    client.close();
  }
});

test("projects whether each vehicle arrived or came with its yard's first publication", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await createProjectionTables(client);
    const firstPublication = new Date("2026-11-21T12:00:00Z");
    await drizzle(client)
      .insert(yardArrivalBaseline)
      .values([
        // 0017 established yards that had inventory before baselines at 0.
        { source: "pullapart", locationCode: "5", establishedAt: new Date(0) },
        {
          source: "calton",
          locationCode: "calton",
          establishedAt: firstPublication,
        },
      ]);
    const calton = { ...legacy, source: "calton", locationCode: "calton" };
    const records = await projectSearchVehicles(drizzle(client), [
      { ...legacy, firstSeenAt: new Date("2026-11-21T08:00:00Z") },
      { ...calton, vin: "BACKFILL", firstSeenAt: firstPublication },
      {
        ...calton,
        vin: "ARRIVAL",
        firstSeenAt: new Date("2026-11-22T07:00:00Z"),
        availableDate: "2026-11-21",
      },
      // A yard whose first run has not published yet.
      {
        ...legacy,
        vin: "UNPUBLISHED",
        source: "jimsimport",
        locationCode: "jims",
      },
    ]);
    expect(
      records.map(({ objectID, firstSighting }) => [objectID, firstSighting]),
    ).toEqual([
      [legacy.vin, "arrival"],
      ["BACKFILL", "yard_backfill"],
      ["ARRIVAL", "arrival"],
      ["UNPUBLISHED", "yard_backfill"],
    ]);
  } finally {
    client.close();
  }
});
