import { warmVinDecodeCache } from "./vin-cache-warmer";
import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import { vinDecodeCache, vehicleModelRedirect } from "~/schema";
import {
  canonicalizeVinVehicles,
  rememberModelRedirects,
} from "./vin-canonicalization";
import { VinDecode } from "./vin-decode";
import type { CanonicalVehicle } from "./types";

const row: CanonicalVehicle = {
  vin: "1FTPW14506KD19655",
  year: 2006,
  make: "FORD",
  model: "TFORD150",
  source: "pyp",
  color: null,
  stockNumber: null,
  imageUrl: null,
  availableDate: null,
  locationCode: "1",
  locationName: "Yard",
  locationCity: "City",
  state: "Ohio",
  stateAbbr: "OH",
  lat: 0,
  lng: 0,
  section: null,
  row: null,
  space: null,
  detailsUrl: null,
  partsUrl: null,
  pricesUrl: null,
  engine: null,
  trim: "King Ranch",
  transmission: null,
};
const decoded = { make: "Ford", model: "F-150", year: 2006, trim: "XLT" };
async function setup() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(
    "create table vehicle (vin text primary key);" +
      readFileSync(
        new URL(
          "../../../drizzle/0026_vin_canonical_models.sql",
          import.meta.url,
        ),
        "utf8",
      ),
  );
  return { client, database: drizzle(client) };
}

test("reuses one pattern across serials and calls; keeps raw model and source trim", async () => {
  const { client, database } = await setup();
  let calls = 0;
  const decoder = {
    decode: async (requests: readonly { key: string }[]) => {
      calls++;
      return {
        status: "complete" as const,
        decodes: new Map(requests.map((r) => [r.key, decoded])),
      };
    },
  };
  try {
    const rows = [row, { ...row, vin: "1FTPW14596K123456", trim: null }];
    await warmVinDecodeCache(database, rows, decoder);
    const result = await canonicalizeVinVehicles(database, rows);
    expect(result[0]).toMatchObject({
      make: "Ford",
      model: "F-150",
      sourceMake: "FORD",
      sourceModel: "TFORD150",
      trim: "King Ranch",
    });
    expect(result[1]?.trim).toBe("XLT");
    await warmVinDecodeCache(database, [row], decoder);
    expect(calls).toBe(1);
    expect(row.model).toBe("TFORD150");
  } finally {
    client.close();
  }
});

test("failed patterns fall back, respect cooldown and retry later; invalid VINs never request", async () => {
  const { client, database } = await setup();
  let calls = 0;
  const decoder = {
    decode: async () => {
      calls++;
      return {
        status: "unavailable" as const,
        decodes: new Map<string, typeof decoded>(),
      };
    },
  };
  try {
    const rows = [row, { ...row, vin: "OLD-SERIAL", year: 1975 }];
    await warmVinDecodeCache(database, rows, decoder);
    const fallback = await canonicalizeVinVehicles(database, rows);
    expect(fallback[0]).toMatchObject({
      make: "Ford",
      model: "TFORD150",
      trim: "King Ranch",
    });
    await warmVinDecodeCache(database, [row], decoder);
    expect(calls).toBe(1);
    await database.update(vinDecodeCache).set({ retryAfter: new Date(0) });
    await warmVinDecodeCache(database, [row], {
      decode: async (requests) => ({
        status: "complete",
        decodes: new Map(requests.map((r) => [r.key, decoded])),
      }),
    });
    const retry = await canonicalizeVinVehicles(database, [row]);
    expect(retry[0]?.model).toBe("F-150");
    expect(VinDecode.identity("OLD-SERIAL", 1975)).toBeNull();
  } finally {
    client.close();
  }
});

test("budget defers new patterns and preserves cached identities", async () => {
  const { client, database } = await setup();
  try {
    const rows = Array.from({ length: 101 }, (_, i) => ({
      ...row,
      vin: `1FT${String(i).padStart(5, "0")}06K123456`,
    }));
    let requested = 0;
    await warmVinDecodeCache(database, rows, {
      decode: async (requests) => {
        requested = requests.length;
        return {
          status: "complete" as const,
          decodes: new Map(requests.map((r) => [r.key, decoded])),
        };
      },
    });
    const result = await canonicalizeVinVehicles(database, rows);
    expect(requested).toBe(100);
    expect(result.filter((r) => r.model === "F-150")).toHaveLength(100);
    expect(result[100]?.model).toBe(row.model);
  } finally {
    client.close();
  }
});

test("old model URLs persist and ambiguous mappings cannot become arbitrary redirects", async () => {
  const { client, database } = await setup();
  try {
    const canonical = {
      ...row,
      make: "Ford",
      model: "F-150",
      sourceMake: "FORD",
      sourceModel: "TFORD150",
    };
    await rememberModelRedirects(database, [canonical]);
    expect(await database.select().from(vehicleModelRedirect)).toEqual([
      { fromPath: "/cars/ford/tford150", toPath: "/cars/ford/f-150" },
    ]);
    await rememberModelRedirects(database, [{ ...canonical, model: "F-250" }]);
    await rememberModelRedirects(database, [canonical]);
    expect(
      (await database.select().from(vehicleModelRedirect))[0]?.toPath,
    ).toBe("/cars/ford");
  } finally {
    client.close();
  }
});
