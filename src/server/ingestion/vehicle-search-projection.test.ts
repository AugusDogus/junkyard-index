import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import { yard, vehicle } from "~/schema";
import { projectSearchVehicles } from "./vehicle-search-projection";
import {
  CURRENT_SEARCH_SCHEMA_VERSION,
  ARRIVAL_DATE_SEARCH_SCHEMA_VERSION,
} from "~/lib/search-index-schema";

const legacy: typeof vehicle.$inferSelect = {
  vin: "YV1LS55A9X1567408",
  source: "pullapart",
  year: 1999,
  make: "Volvo",
  model: "S70",
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

test("existing rows are reprojected with the yard page's authoritative operator name", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(
      readFileSync(
        new URL("../../../drizzle/0007_yard_metadata.sql", import.meta.url),
        "utf8",
      ),
    );
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
