import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Effect } from "effect";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { Database } from "./context";
import {
  streamAutorecyclerInventoryWithPageFetcher,
  type AutorecyclerStreamResult,
} from "./autorecycler-connector";
import { parseOrgGeoFromOrganizationDoc } from "./autorecycler-geo";
import type { AutorecyclerCursor } from "./autorecycler-cursor";
import type { CanonicalVehicle } from "./types";

const directory = new URL("./fixtures/ario/", import.meta.url);
test("the two current legacy customers replay across saved checkpoints without network requests", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.execute(`create table autorecycler_org_geo (
      org_lookup text primary key, lat real not null, lng real not null,
      location_name text not null, location_city text not null, state text not null,
      state_abbr text not null, address text, updated_at integer not null,
      resolution_version integer not null default 1
    )`);
    const orgs = z
      .object({
        docs: z.array(
          z.object({
            _id: z.string(),
            _type: z.string(),
            found: z.boolean(),
            _source: z.record(z.unknown()),
          }),
        ),
      })
      .parse(
        await Bun.file(new URL("legacy-active-orgs.json", directory)).json(),
      );
    const eligibleYards: string[] = [];
    for (const org of orgs.docs) {
      const key = `1348695171700984260__LOOKUP__${org._id}`;
      const geo = parseOrgGeoFromOrganizationDoc(org, key);
      if (!geo) throw new Error(`Missing saved legacy yard geography ${key}`);
      eligibleYards.push(key);
      await client.execute({
        sql: "insert into autorecycler_org_geo values (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)",
        args: [
          key,
          geo.lat,
          geo.lng,
          geo.locationName,
          geo.locationCity,
          geo.state,
          geo.stateAbbr,
          geo.address ?? null,
        ],
      });
    }
    let cursor: AutorecyclerCursor = {
      source: "autorecycler",
      phase: "page",
      beforeId: null,
      freshness: {
        asOf: Date.parse("2026-11-15T21:55:00Z"),
        legacy: {},
        eligibleYards,
      },
    };
    const vehicles: CanonicalVehicle[] = [];
    let page = 0;
    let rejected = 0;
    let excluded = 0;
    while (cursor.phase !== "complete") {
      const result: AutorecyclerStreamResult = await Effect.runPromise(
        streamAutorecyclerInventoryWithPageFetcher(
          {
            startCursor: cursor,
            maxPages: 1,
            onBatch: (batch) =>
              Effect.sync(() => {
                vehicles.push(...batch);
              }),
          },
          async () => {
            const number = page++;
            if (number === 2)
              return Bun.file(
                new URL("legacy-active-2.json", directory),
              ).json();
            const bytes = await Bun.file(
              new URL(`legacy-active-${number}.json.gz`, directory),
            ).arrayBuffer();
            return JSON.parse(gunzipSync(new Uint8Array(bytes)).toString());
          },
          (orgs) =>
            Effect.succeed(
              new Map(orgs.map((org) => [org, "independent"] as const)),
            ),
        ).pipe(Effect.provideService(Database, drizzle(client))),
      );
      cursor = result.cursor;
      rejected += result.accounting?.recordsRejected ?? 0;
      excluded += result.accounting?.recordsExcluded ?? 0;
    }
    expect(page).toBe(3);
    expect(vehicles).toHaveLength(723);
    expect(new Set(vehicles.map((vehicle) => vehicle.vin)).size).toBe(723);
    expect(
      vehicles.filter(
        (vehicle) => vehicle.locationName === "A-1 METALS & AUTO SALVAGE INC",
      ),
    ).toHaveLength(183);
    expect(
      vehicles.filter(
        (vehicle) => vehicle.locationName === "JDM AUTOMOTIVE & RECYCLING",
      ),
    ).toHaveLength(540);
    expect(rejected).toBe(26);
    const jdm = vehicles.filter(
      (vehicle) => vehicle.locationName === "JDM AUTOMOTIVE & RECYCLING",
    );
    expect(jdm.every((vehicle) => vehicle.model !== vehicle.make)).toBe(true);
    // All 26 rejects are in JDM's 566 eligible rows, safely below 10%.
    expect(26 / 566).toBeLessThan(0.1);
    expect(excluded).toBe(3);
    expect(cursor.freshness?.eligibleYards).toEqual(eligibleYards);
  } finally {
    client.close();
  }
});
