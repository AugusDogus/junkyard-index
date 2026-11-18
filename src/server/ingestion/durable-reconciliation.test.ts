import { RETIRED_INGESTION_SOURCES } from "~/lib/ingestion-source";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { UrgiisCursor } from "./urgiis-cursor";
import { RECONCILIATION_TEST_SCHEMA } from "./durable-reconciliation-test-fixtures";
import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import { reconcileDurableIngestionRun } from "./durable-reconciliation";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import { streamPullNSaveInventoryWithRequestGate } from "./pullnsave-connector";
import { connectorChunkMetrics } from "./connector-chunk";
import { Effect } from "effect";
import type { CanonicalVehicle } from "./types";
import { streamAutorecyclerInventoryWithPageFetcher } from "./autorecycler-connector";
import type { AutorecyclerFreshness } from "./autorecycler-freshness-state";
import { Database } from "./context";
import { validateDurableSourceRuns } from "./durable-source-validation";
import {
  getDurableSourceDefinition,
  serializeDurableSourceCursor,
} from "./durable-source";
import { SourceValidationPolicy } from "./source-validation";

const TEST_SCHEMA = RECONCILIATION_TEST_SCHEMA;

async function yardInventoryRows(client: ReturnType<typeof createClient>) {
  const result = await client.execute(
    "select source, location_code, vehicle_count from yard_inventory order by source, location_code",
  );
  return result.rows.map((row) => ({
    source: row.source,
    code: row.location_code,
    count: row.vehicle_count,
  }));
}

function snapshot(
  source: "row52" | "pyp" | "gopullit" | "autorecycler",
  color: string,
): CanonicalVehicle {
  return {
    source,
    vin: "VIN-1",
    year: 2018,
    make: "FORD",
    model: "FOCUS",
    color,
    stockNumber: "A1",
    imageUrl: null,
    availableDate: null,
    locationCode: "yard-1",
    locationName: "Yard 1",
    locationCity: "Tulsa",
    state: "Oklahoma",
    stateAbbr: "OK",
    lat: 36.1,
    lng: -95.9,
    section: null,
    row: null,
    space: null,
    detailsUrl: null,
    partsUrl: null,
    pricesUrl: null,
    engine: null,
    trim: null,
    transmission: null,
  };
}

async function stageSnapshots(params: {
  client: ReturnType<typeof createClient>;
  store: IngestionSnapshotStore;
  runId: string;
  vehicles: readonly CanonicalVehicle[];
}) {
  for (const vehicle of params.vehicles) {
    const pathname = await params.store.put({
      runId: params.runId,
      source: vehicle.source,
      chunk: { vehicles: [vehicle], observedVins: [] },
    });
    await params.client.execute({
      sql: "update ingestion_source_run set snapshot_chunks = json_insert(snapshot_chunks, '$[#]', ?) where id = ?",
      args: [pathname, `${params.runId}:${vehicle.source}`],
    });
  }
}

describe("bounded durable reconciliation", () => {
  test("keeps backfills unknown per yard across batches and records only later arrivals", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const database = drizzle(client);
      const store = IngestionSnapshotStore.memory();
      const first = new Date("2026-11-15T12:00:00Z");
      const second = new Date("2026-11-16T12:00:00Z");
      const backfill = Array.from({ length: 501 }, (_, index) => ({
        ...snapshot("pyp", "Blue"),
        vin: `A-${String(index).padStart(4, "0")}`,
      }));
      async function publish(
        id: string,
        at: Date,
        vehicles: CanonicalVehicle[],
      ) {
        await database.insert(ingestionRun).values({
          id,
          source: "pyp",
          status: "running",
          stage: "reconcile_upsert",
          activeSlot: 1,
          commitStartedAt: at,
          acceptedSources: JSON.stringify(["pyp"]),
          startedAt: at,
          lastProgressAt: at,
        });
        await database.insert(ingestionSourceRun).values({
          id: `${id}:pyp`,
          runId: id,
          source: "pyp",
          status: "success",
          acceptanceStatus: "accepted",
          uniqueVehicles: vehicles.length,
          startedAt: at,
        });
        await stageSnapshots({ client, store, runId: id, vehicles });
        let result = await reconcileDurableIngestionRun({
          runId: id,
          database,
          batchClient: client,
          snapshotStore: store,
          budgetMs: 0,
        });
        while (result.status === "paused") {
          result = await reconcileDurableIngestionRun({
            runId: id,
            database,
            batchClient: client,
            snapshotStore: store,
            budgetMs: 0,
          });
        }
        await database
          .update(ingestionRun)
          .set({ activeSlot: null })
          .where(eq(ingestionRun.id, id));
      }
      await publish("arrival-first", first, backfill);
      expect(
        (
          await client.execute(
            "select count(*) as count from vehicle where observed_arrival_at is not null",
          )
        ).rows[0]?.count,
      ).toBe(0);
      const newCar = { ...snapshot("pyp", "Blue"), vin: "B-new" };
      const newYard = { ...newCar, vin: "C-new-yard", locationCode: "yard-2" };
      const datedCar = {
        ...newCar,
        vin: "D-dated",
        availableDate: "2026-11-14T12:00:00Z",
      };
      await publish("arrival-second", second, [
        ...backfill,
        newCar,
        newYard,
        datedCar,
      ]);
      const rows = (
        await client.execute(
          "select vin, observed_arrival_at from vehicle where vin >= 'B' order by vin",
        )
      ).rows;
      expect(
        rows.map((row) => ({
          vin: row.vin,
          observed_arrival_at: row.observed_arrival_at,
        })),
      ).toEqual([
        { vin: "B-new", observed_arrival_at: second.getTime() },
        { vin: "C-new-yard", observed_arrival_at: null },
        { vin: "D-dated", observed_arrival_at: null },
      ]);
      // Each yard keeps the run timestamp of its first published crawl.
      expect(
        (
          await client.execute(
            "select location_code, established_at from yard_arrival_baseline order by location_code",
          )
        ).rows.map((row) => ({
          location_code: row.location_code,
          established_at: row.established_at,
        })),
      ).toEqual([
        { location_code: "yard-1", established_at: first.getTime() },
        { location_code: "yard-2", established_at: second.getTime() },
      ]);
      await publish("arrival-third", new Date("2026-11-17T12:00:00Z"), [
        ...backfill,
        { ...newCar, availableDate: datedCar.availableDate },
        newYard,
        datedCar,
      ]);
      expect(
        (
          await client.execute(
            "select available_date, observed_arrival_at from vehicle where vin = 'B-new'",
          )
        ).rows[0],
      ).toMatchObject({
        available_date: datedCar.availableDate,
        observed_arrival_at: second.getTime(),
      });
      // Retiring every car does not turn a published yard into a first crawl again.
      await client.execute(
        "delete from vehicle where location_code = 'yard-1'",
      );
      const fourth = new Date("2026-11-18T12:00:00Z");
      await publish("arrival-fourth", fourth, [
        { ...newCar, vin: "E-after-empty" },
        newYard,
      ]);
      expect(
        (
          await client.execute(
            "select observed_arrival_at from vehicle where vin = 'E-after-empty'",
          )
        ).rows[0]?.observed_arrival_at,
      ).toBe(fourth.getTime());
    } finally {
      client.close();
    }
  });

  test.each([
    "hawaiiparts",
    "modernmuscle",
    "carsandparts",
    "spartan",
    "oemgarage",
    "hagerman",
    "kandr",
    "jimsimport",
    "lonestarimports",
    "alshned",
    "allied",
    "urgiis",
    "byot",
  ] as const)(
    "%s cannot publish staged inventory from a successful nonterminal cursor",
    async (source) => {
      const client = createClient({ url: ":memory:" });
      try {
        await client.executeMultiple(TEST_SCHEMA);
        const database = drizzle(client);
        const snapshotStore = IngestionSnapshotStore.memory();
        const repository = createDurableIngestionRepository(
          database,
          client,
          snapshotStore,
        );
        const runId = "run-nonterminal-" + source;
        await repository.initialize(runId, async () => [source]);
        const count = SourceValidationPolicy.minimumUniqueInventory[source];
        const vehicles: CanonicalVehicle[] = Array.from(
          { length: count },
          (_, index) => ({
            ...snapshot("pyp", "Blue"),
            source,
            vin: "1HGCM82633A" + String(index).padStart(6, "0"),
          }),
        );
        const chunk = await snapshotStore.put({
          runId,
          source,
          chunk: { vehicles, observedVins: [] },
        });
        await database
          .update(ingestionSourceRun)
          .set({
            status: "success",
            vehiclesProcessed: count,
            uniqueVehicles: count,
            nextCursor: serializeDurableSourceCursor(
              getDurableSourceDefinition(source).initialCursor,
            ),
            snapshotChunks: JSON.stringify([chunk]),
          })
          .where(eq(ingestionSourceRun.id, runId + ":" + source));
        const validation = await validateDurableSourceRuns({
          runId,
          database,
          batchClient: client,
          snapshotStore,
        });
        expect(validation.status).toBe("ready");
        if (validation.status !== "ready")
          throw new Error("Expected completed source validation");
        expect(validation.acceptedSources).toEqual([]);
        expect(validation.rejectedSources).toHaveLength(1);
        expect(validation.rejectedSources[0]?.source).toBe(source);
        expect(validation.rejectedSources[0]?.errors.join(" ")).toContain(
          "terminal",
        );
        expect(
          (await client.execute("select count(*) as count from vehicle"))
            .rows[0]?.count,
        ).toBe(0);
      } finally {
        client.close();
      }
    },
  );
  test("URG publishes healthy tenants while blocked yards keep their missing and deletion counters", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const database = drizzle(client);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        database,
        client,
        snapshotStore,
      );
      const runId = "urg-tenant-isolation";
      await repository.initialize(runId, async () => ["urgiis"]);
      const healthy = URGIIS_TENANTS.find((t) => t.code === "mars");
      const blocked = URGIIS_TENANTS.find((t) => t.code === "eagle");
      if (!healthy || !blocked)
        throw new Error("Missing configured test yards");
      const initial = UrgiisCursor.initial();
      const cursor = UrgiisCursor.checkpoint({
        source: initial.source,
        version: initial.version,
        scope: initial.scope,
        startedAt: null,
        asOf: null,
        statePath: null,
        stateHash: null,
        requests: 0,
        bytes: 0,
        phase: "complete",
        completed: URGIIS_TENANTS.map((t) =>
          t === healthy
            ? { code: t.code, accepted: t.minimumInventory }
            : {
                code: t.code,
                blocked: "Ordinary model remains empty after retry",
              },
        ),
      });
      const vehicles = Array.from(
        { length: healthy.minimumInventory },
        (_, i): CanonicalVehicle => ({
          ...snapshot("pyp", "Blue"),
          source: "urgiis",
          locationCode: healthy.yard.code,
          vin: "URG-NEW-" + i,
        }),
      );
      const chunk = await snapshotStore.put({
        runId,
        source: "urgiis",
        chunk: { vehicles, observedVins: [] },
      });
      await database
        .update(ingestionSourceRun)
        .set({
          status: "success",
          vehiclesProcessed: vehicles.length,
          uniqueVehicles: vehicles.length,
          nextCursor: serializeDurableSourceCursor(cursor),
          snapshotChunks: JSON.stringify([chunk]),
        })
        .where(eq(ingestionSourceRun.id, runId + ":urgiis"));
      for (const [vin, code, missing, runs] of [
        ["URG-BLOCKED", blocked.yard.code, 1, 2],
        ["URG-RETIRED", healthy.yard.code, null, 0],
      ] as const) {
        await client.execute({
          sql: "insert into vehicle (vin, source, year, make, model, location_code, location_name, location_city, state, state_abbr, lat, lng, first_seen_at, last_seen_at, missing_since_at, missing_run_count) values (?, 'urgiis', 2018, 'Ford', 'Focus', ?, 'Yard', 'City', 'Oklahoma', 'OK', 1, 1, 1, 1, ?, ?)",
          args: [vin, code, missing, runs],
        });
      }
      const validation = await validateDurableSourceRuns({
        runId,
        database,
        batchClient: client,
        snapshotStore,
      });
      expect(validation).toMatchObject({
        status: "ready",
        acceptedSources: ["urgiis"],
      });
      const result = await reconcileDurableIngestionRun({
        runId,
        database,
        batchClient: client,
        snapshotStore,
      });
      expect(result.status).toBe("complete");
      const preserved = (
        await client.execute(
          "select missing_since_at, missing_run_count, last_seen_at from vehicle where vin = 'URG-BLOCKED'",
        )
      ).rows[0];
      expect(preserved).toMatchObject({
        missing_since_at: 1,
        missing_run_count: 2,
        last_seen_at: 1,
      });
      expect(
        (
          await client.execute(
            "select missing_run_count from vehicle where vin = 'URG-RETIRED'",
          )
        ).rows[0]?.missing_run_count,
      ).toBe(1);
      expect(
        (
          await client.execute(
            "select count(*) as count from vehicle where vin like 'URG-NEW-%'",
          )
        ).rows[0]?.count,
      ).toBe(healthy.minimumInventory);
    } finally {
      client.close();
    }
  });
  test("AutoRecycler preserves unresolved independent VINs across resume but lets excluded mirror VINs retire", async () => {
    const client = createClient({ url: ":memory:" });
    const asOf = Date.now();
    const originalFetch = globalThis.fetch;
    const recordId = "1761169972557x110781710658965700";
    const org = `1348695171700984260__LOOKUP__${recordId}`;
    const knownOrg =
      "1348695171700984260__LOOKUP__1726602417880x199387504054651780";
    const presentVin = "KNADE123666155428";
    const mirrorOrg =
      "1348695171700984260__LOOKUP__1761169592468x394558876247902400";
    const mirrorVin = "1N4AL21EX9N533416";
    const missing = {
      _source: {
        organization_custom_organization: org,
        inventory_id_text: "1761173625126x883105909157925400",
        vin_text: ` ${presentVin.toLowerCase()} `,
        name_text: "2006 Kia Rio",
        added_date_date: asOf,
      },
    };
    let geoRequests = 0;
    const offsets: Array<string | null> = [];
    try {
      await client.executeMultiple(`${TEST_SCHEMA}
        create table autorecycler_org_geo (
          org_lookup text primary key, lat real not null, lng real not null,
          location_name text not null, location_city text not null,
          state text not null, state_abbr text not null, address text,
          updated_at integer not null, resolution_version integer not null default 0
        );`);
      for (const [id, version] of [
        [org, 0],
        [knownOrg, 1],
        [mirrorOrg, 1],
      ] as const) {
        await client.execute({
          sql: "insert into autorecycler_org_geo values (?, 32.44, -84.94, 'Saved yard', 'Columbus', 'Georgia', 'GA', 'Saved address', 1, ?)",
          args: [id, version],
        });
      }
      const cachedBefore = (
        await client.execute(
          "select * from autorecycler_org_geo order by org_lookup",
        )
      ).rows;
      const firstSeenAt = Date.now() - 86_400_000;
      for (const vin of [presentVin, "VIN-ABSENT", mirrorVin]) {
        await client.execute({
          sql: "insert into vehicle (vin, source, year, make, model, color, location_code, location_name, location_city, state, state_abbr, lat, lng, first_seen_at, last_seen_at, missing_since_at, missing_run_count) values (?, 'autorecycler', 2006, 'Kia', 'Rio', 'Blue', ?, 'Saved yard', 'Columbus', 'Georgia', 'GA', 32.44, -84.94, ?, ?, ?, 2)",
          args: [
            vin,
            vin === mirrorVin ? mirrorOrg : org,
            firstSeenAt,
            firstSeenAt,
            firstSeenAt,
          ],
        });
      }
      globalThis.fetch = Object.assign(
        async (input: RequestInfo | URL) => {
          geoRequests++;
          const url = String(input);
          if (url.includes("/mget"))
            return Response.json({
              docs: [
                {
                  _id: recordId,
                  _type: "custom.organization",
                  found: true,
                  _source: { address_city_text: "Winston-Salem" },
                },
              ],
            });
          if (url.includes("/msearch"))
            return Response.json({ responses: [{ hits: { hits: [] } }] });
          if (url.includes("/init/data"))
            return Response.json([
              {
                type: "custom.inventory",
                data: {
                  organization_custom_organization: org,
                  gps_location_geographic_address: { lat: 33.7, lng: -84.4 },
                },
              },
            ]);
          throw new Error("Unexpected provider endpoint");
        },
        { preconnect: originalFetch.preconnect },
      );
      const database = drizzle(client);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        database,
        client,
        snapshotStore,
      );
      const runId = "run-autorecycler-quarantine";
      await repository.initialize(runId);
      let freshness: AutorecyclerFreshness = {
        asOf,
        legacy: {},
        eligibleYards: [org, knownOrg],
      };
      // This test starts after the freshness and Ario stages, at the legacy traversal.
      await client.execute({
        sql: "update ingestion_source_run set next_cursor = ? where run_id = ? and source = 'autorecycler'",
        args: [
          JSON.stringify({ phase: "page", beforeId: null, freshness }),
          runId,
        ],
      });
      const known = Array.from({ length: 100 }, (_, index) => ({
        _source: {
          organization_custom_organization: knownOrg,
          inventory_id_text: `known-${index}`,
          vin_text: `1HGCM82633A${String(index).padStart(6, "0")}`,
          name_text: "2003 Honda Accord",
          added_date_date: asOf,
        },
      }));
      const searchId = (index: number) => `${1_700_000_000_000 - index}x1`;
      for (const startFrom of [0, 3]) {
        const startCursor = {
          source: "autorecycler",
          phase: "page",
          beforeId: startFrom === 0 ? null : searchId(startFrom - 1),
          freshness,
        } as const;
        const vehicles: CanonicalVehicle[] = [];
        const result = await Effect.runPromise(
          streamAutorecyclerInventoryWithPageFetcher(
            {
              startCursor,
              maxPages: 2,
              onBatch: (batch) =>
                Effect.sync(() => {
                  vehicles.push(...batch);
                }),
            },
            async (beforeId) => {
              offsets.push(beforeId);
              const from =
                beforeId === null
                  ? 0
                  : 1_700_000_000_000 - Number(beforeId.split("x")[0]) + 1;
              const hits =
                from === 0
                  ? [
                      missing,
                      { _source: { ...missing._source, vin_text: "invalid" } },
                    ]
                  : from === 2
                    ? [missing]
                    : from >= 108
                      ? []
                      : [
                          missing,
                          {
                            _source: {
                              ...missing._source,
                              organization_custom_organization: mirrorOrg,
                              vin_text: mirrorVin,
                            },
                          },
                          {
                            _source: {
                              ...missing._source,
                              organization_custom_organization: mirrorOrg,
                              vin_text: "1HGCM82633A000000",
                            },
                          },
                          ...known,
                          ...known.slice(0, 1),
                          { _source: {} },
                        ];
              return {
                responses: [
                  {
                    hits: {
                      hits: hits.map((hit, index) => ({
                        ...hit,
                        _id: searchId(from + index),
                      })),
                    },
                    at_end: from === 3,
                  },
                ],
              };
            },
            (orgs) =>
              Effect.succeed(
                new Map(
                  orgs.map(
                    (org) =>
                      [
                        org,
                        org === mirrorOrg ? "direct-provider" : "independent",
                      ] as const,
                  ),
                ),
              ),
          ).pipe(Effect.provideService(Database, database)),
        );
        expect(result.status).toBe(startFrom === 0 ? "paused" : "complete");
        const nextFreshness = {
          ...freshness,
          legacyDateEvidence: {
            [org]: true,
            ...(startFrom === 0 ? {} : { [knownOrg]: true }),
          },
        };
        expect(result.cursor).toEqual(
          startFrom === 0
            ? {
                source: "autorecycler",
                phase: "page",
                beforeId: searchId(2),
                freshness: nextFreshness,
              }
            : {
                source: "autorecycler",
                phase: "complete",
                freshness: nextFreshness,
              },
        );
        expect(result.observedVins).toEqual([presentVin]);
        expect(result.errors).toEqual([]);
        expect(result.warnings?.join(" ")).toContain(
          "Observed VINs are preserved",
        );
        expect(result.accounting).toEqual(
          startFrom === 0
            ? {
                recordsProcessed: 3,
                recordsExcluded: 2,
                recordsRejected: 1,
                duplicateVehicles: 0,
              }
            : {
                recordsProcessed: 105,
                recordsExcluded: 3,
                recordsRejected: 1,
                duplicateVehicles: 1,
              },
        );
        expect(vehicles).toHaveLength(startFrom === 0 ? 0 : 100);
        expect(
          vehicles.every((vehicle) => vehicle.locationCode === knownOrg),
        ).toBe(true);
        await repository.checkpointChunk({
          runId,
          requestedCursor: startCursor,
          fetched: {
            cursor: result.cursor,
            status: result.status,
            pagesProcessed: result.pagesProcessed,
            ...connectorChunkMetrics(result, vehicles.length),
            errors: result.errors,
            vehicles,
            yards: [],
            observedVins: result.observedVins ?? [],
          },
        });
        freshness = nextFreshness;
      }
      expect(offsets).toEqual([null, searchId(1), searchId(2), searchId(107)]);
      expect(geoRequests).toBe(6);
      expect(
        (
          await client.execute(
            "select * from autorecycler_org_geo order by org_lookup",
          )
        ).rows,
      ).toEqual(cachedBefore);
      await client.execute(
        "update ingestion_source_run set status = 'failed' where source <> 'autorecycler'",
      );
      const validation = await validateDurableSourceRuns({
        runId,
        database,
        batchClient: client,
        snapshotStore,
      });
      expect(validation.status).toBe("ready");
      if (validation.status !== "ready") throw new Error("Expected validation");
      expect(validation.acceptedSources).toEqual(["autorecycler"]);
      expect(
        (await repository.getSourceRuns(runId)).find(
          (source) => source.source === "autorecycler",
        ),
      ).toMatchObject({
        status: "success",
        acceptanceStatus: "accepted",
        vehiclesProcessed: 103,
        uniqueVehicles: 100,
        rejectedVehicles: 2,
        duplicateVehicles: 1,
      });
      await reconcileDurableIngestionRun({
        runId,
        database,
        batchClient: client,
        snapshotStore,
        budgetMs: 0,
      });
      await reconcileDurableIngestionRun({
        runId,
        database,
        batchClient: client,
        snapshotStore,
        budgetMs: 0,
      });
      const preserved = (
        await client.execute({
          sql: "select * from vehicle where vin = ?",
          args: [presentVin],
        })
      ).rows[0];
      expect(preserved).toMatchObject({
        missing_run_count: 0,
        missing_since_at: null,
        first_seen_at: firstSeenAt,
        color: "Blue",
        location_name: "Saved yard",
        location_city: "Columbus",
        lat: 32.44,
        lng: -84.94,
      });
      expect(Number(preserved?.last_seen_at)).toBeGreaterThan(firstSeenAt);
      expect(
        (
          await client.execute(
            "select vin from vehicle where vin = 'VIN-ABSENT'",
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await client.execute({
            sql: "select vin from vehicle where vin = ?",
            args: [mirrorVin],
          })
        ).rows,
      ).toHaveLength(0);
      expect(
        (await client.execute("select count(*) as count from vehicle")).rows[0]
          ?.count,
      ).toBe(101);
    } finally {
      globalThis.fetch = originalFetch;
      client.close();
    }
  });

  test("an observation-only return clears missing state, queues an index refresh, and resets the absence streak", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const database = drizzle(client);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        database,
        client,
        snapshotStore,
      );
      const firstSeenAt = Date.now() - 86_400_000;
      await client.execute({
        sql: `insert into vehicle (vin, source, year, make, model, color, location_code, location_name, location_city, state, state_abbr, lat, lng, first_seen_at, last_seen_at, missing_since_at, missing_run_count) values ('VIN-RETURNED', 'pullnsave', 2003, 'Chevrolet', 'Cavalier', 'Blue', 'PNS-10', 'Saved Yard', 'Mesa', 'Arizona', 'AZ', 33.43, -111.85, ?, ?, ?, 2)`,
        args: [firstSeenAt, firstSeenAt, firstSeenAt],
      });
      await repository.initialize("run-returned");
      await repository.checkpointChunk({
        runId: "run-returned",
        requestedCursor: { source: "pullnsave", page: 1 },
        fetched: {
          cursor: { source: "pullnsave", page: 2 },
          status: "complete",
          pagesProcessed: 1,
          vehiclesProcessed: 0,
          uniqueVehicles: 0,
          duplicateVehicles: 0,
          rejectedVehicles: 0,
          errors: [],
          vehicles: [],
          yards: [],
          observedVins: ["VIN-RETURNED"],
        },
      });
      await client.execute(
        "update ingestion_source_run set acceptance_status = 'accepted' where run_id = 'run-returned' and source = 'pullnsave'",
      );
      await client.execute(
        "update ingestion_run set stage = 'reconcile_upsert', accepted_sources = '[\"pullnsave\"]' where id = 'run-returned'",
      );
      await reconcileDurableIngestionRun({
        runId: "run-returned",
        database,
        batchClient: client,
        snapshotStore,
        budgetMs: 0,
      });
      await reconcileDurableIngestionRun({
        runId: "run-returned",
        database,
        batchClient: client,
        snapshotStore,
        budgetMs: 0,
      });
      const returned = await client.execute(
        "select missing_run_count, missing_since_at, first_seen_at, last_seen_at, color, location_name from vehicle where vin = 'VIN-RETURNED'",
      );
      expect(returned.rows[0]).toMatchObject({
        missing_run_count: 0,
        missing_since_at: null,
        first_seen_at: firstSeenAt,
        color: "Blue",
        location_name: "Saved Yard",
      });
      expect(Number(returned.rows[0]?.last_seen_at)).toBeGreaterThan(
        firstSeenAt,
      );
      expect(
        (
          await client.execute(
            "select vin, change_type from vehicle_change_v2 where run_id = 'run-returned'",
          )
        ).rows.map(({ vin, change_type }) => ({ vin, change_type })),
      ).toEqual([{ vin: "VIN-RETURNED", change_type: "upsert" }]);
      await reconcileDurableIngestionRun({
        runId: "run-returned",
        database,
        batchClient: client,
        snapshotStore,
        budgetMs: 0,
      });
      expect(
        (
          await client.execute(
            "select count(*) as count from vehicle_change_v2 where run_id = 'run-returned'",
          )
        ).rows[0]?.count,
      ).toBe(1);
      expect((await repository.getRun("run-returned")).vehiclesUpserted).toBe(
        1,
      );

      await client.execute(
        "update ingestion_run set active_slot = null, status = 'success' where id = 'run-returned'",
      );
      await repository.initialize("run-absent-again");
      await client.execute(
        "update ingestion_source_run set acceptance_status = 'accepted' where run_id = 'run-absent-again' and source = 'pullnsave'",
      );
      await client.execute(
        "update ingestion_run set stage = 'reconcile_missing', accepted_sources = '[\"pullnsave\"]' where id = 'run-absent-again'",
      );
      await reconcileDurableIngestionRun({
        runId: "run-absent-again",
        database,
        batchClient: client,
        snapshotStore,
        budgetMs: 0,
      });
      expect(
        (
          await client.execute(
            "select missing_run_count from vehicle where vin = 'VIN-RETURNED'",
          )
        ).rows[0]?.missing_run_count,
      ).toBe(1);
    } finally {
      client.close();
    }
  });
  test("metadata failures do not age observed VINs toward deletion while absent vehicles still expire", async () => {
    const client = createClient({ url: ":memory:" });
    const originalFetch = globalThis.fetch;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const database = drizzle(client);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        database,
        client,
        snapshotStore,
      );
      const now = Date.now();
      await repository.initialize("run-old-observation");
      await client.execute(
        "insert into vehicle_observation values ('run-old-observation', 'pullnsave', 'VIN-ABSENT')",
      );
      await client.execute(
        "update ingestion_source_run set acceptance_status = 'accepted' where run_id = 'run-old-observation' and source = 'pullnsave'",
      );
      await client.execute(
        "update ingestion_run set active_slot = null, status = 'success' where id = 'run-old-observation'",
      );
      for (const vin of ["VIN-PRESENT", "VIN-ABSENT", "VIN-UNLISTED"]) {
        await client.execute({
          sql: `insert into vehicle (vin, source, year, make, model, location_code, location_name, location_city, state, state_abbr, lat, lng, first_seen_at, last_seen_at, missing_run_count) values (?, 'pullnsave', 2003, 'Chevrolet', 'Cavalier', 'PNS-10', 'Discovered Yard', 'Mesa', 'Arizona', 'AZ', 33.43, -111.85, ?, ?, 0)`,
          args: [vin, now, now],
        });
      }
      globalThis.fetch = Object.assign(
        async (input: RequestInfo | URL) => {
          if (String(input).endsWith("/inventory/"))
            return new Response(
              '<select id="pns_yard"><option value="0">All</option><option value="1">Salt Lake City</option><option value="10">Discovered Yard</option></select><script>var pns_inventory_sf_ajax = {"nonce":"fixture-nonce"};</script>',
            );
          if (String(input).includes("/v1/Vehicles/Search"))
            return new Response(
              JSON.stringify([
                {
                  astStoreNumber: 8,
                  stockId: "STK-8",
                  vin: "VIN-UNLISTED",
                  year: 2003,
                  make: "CHEVROLET",
                  model: "CAVALIER",
                },
                {
                  astStoreNumber: 10,
                  stockId: "STK-10",
                  vin: "VIN-PRESENT",
                  year: 2003,
                  make: "CHEVROLET",
                  model: "CAVALIER",
                },
                {
                  astStoreNumber: 1,
                  stockId: "STK-1",
                  vin: "VIN-KNOWN",
                  year: 2003,
                  make: "CHEVROLET",
                  model: "CAVALIER",
                },
              ]),
            );
          return new Response("metadata unavailable", { status: 403 });
        },
        { preconnect: originalFetch.preconnect },
      );
      for (let i = 1; i <= 3; i++) {
        const runId = `run-observed-${i}`;
        await repository.initialize(runId);
        const vehicles: CanonicalVehicle[] = [];
        const result = await Effect.runPromise(
          streamPullNSaveInventoryWithRequestGate(
            {
              onBatch: (batch) =>
                Effect.sync(() => {
                  vehicles.push(...batch);
                }),
            },
            (request) => request,
          ),
        );
        expect(result.errors).toEqual([]);
        expect(result.observedVins).toEqual(["VIN-PRESENT"]);
        await repository.checkpointChunk({
          runId,
          requestedCursor: { source: "pullnsave", page: 1 },
          fetched: {
            cursor: { source: "pullnsave", page: result.cursor },
            status: result.status,
            pagesProcessed: result.pagesProcessed,
            ...connectorChunkMetrics(result, vehicles.length),
            errors: result.errors,
            vehicles,
            yards: [],
            observedVins: result.observedVins,
          },
        });
        // Evidence from a source not accepted in this run cannot mask absence.
        await client.execute({
          sql: "insert into vehicle_observation values (?, 'row52', 'VIN-ABSENT')",
          args: [runId],
        });
        // Isolate the missing phase of a source accepted by snapshot validation.
        await client.execute({
          sql: "update ingestion_source_run set acceptance_status = 'accepted' where run_id = ? and source = 'pullnsave'",
          args: [runId],
        });
        await client.execute({
          sql: "update ingestion_run set stage = 'reconcile_missing', accepted_sources = '[\"pullnsave\"]' where id = ?",
          args: [runId],
        });
        expect(
          (
            await reconcileDurableIngestionRun({
              runId,
              database,
              batchClient: client,
              snapshotStore,
              budgetMs: 0,
            })
          ).status,
        ).toBe("complete");
        const present = await client.execute(
          "select missing_run_count, missing_since_at from vehicle where vin = 'VIN-PRESENT'",
        );
        expect(present.rows[0]).toMatchObject({
          missing_run_count: 0,
          missing_since_at: null,
        });
        await client.execute({
          sql: "update ingestion_run set active_slot = null, status = 'success' where id = ?",
          args: [runId],
        });
      }
      expect(
        (
          await client.execute(
            "select vin from vehicle where vin in ('VIN-ABSENT', 'VIN-UNLISTED')",
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await client.execute(
            "select vin from vehicle_change_v2 where vin = 'VIN-PRESENT'",
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
      client.close();
    }
  });
  test("does not reconcile an abandoned run", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const snapshotStore = IngestionSnapshotStore.memory();
      const startedAt = new Date("2026-08-22T07:00:00.000Z");
      await drizzle(client)
        .insert(ingestionRun)
        .values({
          id: "run-abandoned",
          source: "all",
          status: "abandoned",
          stage: "reconcile_missing",
          activeSlot: null,
          acceptedSources: JSON.stringify(["pyp"]),
          startedAt,
          lastProgressAt: startedAt,
        });

      const result = await reconcileDurableIngestionRun({
        runId: "run-abandoned",
        database: drizzle(client),
        batchClient: client,
        snapshotStore,
        budgetMs: 0,
      });

      expect(result).toEqual({ status: "stopped" });
    } finally {
      client.close();
    }
  });

  test("preserves a failed publish stage for projector recovery on resume", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const snapshotStore = IngestionSnapshotStore.memory();
      await client.execute({
        sql: `
          insert into ingestion_run (
            id, source, status, stage, active_slot, accepted_sources,
            started_at, last_progress_at
          ) values (?, 'all', 'running', 'full_reindex_publish_failed', 1,
                    '[]', ?, ?)
        `,
        args: ["run-failed-publish", Date.now(), Date.now()],
      });

      const result = await reconcileDurableIngestionRun({
        runId: "run-failed-publish",
        database: drizzle(client),
        batchClient: client,
        snapshotStore,
        budgetMs: 0,
      });

      expect(result.status).toBe("complete");
      const row = await client.execute(
        "select stage from ingestion_run where id = 'run-failed-publish'",
      );
      expect(row.rows[0]?.stage).toBe("full_reindex_publish_failed");
    } finally {
      client.close();
    }
  });

  test("reconciles many batches in one step, stamping vehicles at commit", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const database = drizzle(client);
      const startedAt = new Date("2026-08-22T07:00:00.000Z");
      // Parallel runs stage before claiming the commit; vehicles are first
      // seen when the run commits, after earlier runs matched alerts.
      const commitStartedAt = new Date("2026-08-22T08:30:00.000Z");
      await database.insert(ingestionRun).values({
        id: "run-many",
        source: "pyp",
        status: "running",
        stage: "reconcile_upsert",
        activeSlot: 1,
        commitStartedAt,
        acceptedSources: JSON.stringify(["pyp"]),
        startedAt,
        lastProgressAt: startedAt,
      });
      await database.insert(ingestionSourceRun).values({
        id: "run-many:pyp",
        runId: "run-many",
        source: "pyp",
        status: "success",
        acceptanceStatus: "accepted",
        uniqueVehicles: 1_200,
        startedAt,
      });
      const snapshotStore = IngestionSnapshotStore.memory();
      await stageSnapshots({
        client,
        store: snapshotStore,
        runId: "run-many",
        vehicles: Array.from({ length: 1_200 }, (_, index) => ({
          ...snapshot("pyp", "Blue"),
          vin: `VIN-${String(index).padStart(5, "0")}`,
        })),
      });

      const result = await reconcileDurableIngestionRun({
        runId: "run-many",
        database,
        batchClient: client,
        snapshotStore,
      });

      expect(result.status).toBe("complete");
      const count = await client.execute(
        "select count(*) as count from vehicle",
      );
      expect(count.rows[0]?.count).toBe(1_200);
      const firstSeen = await client.execute(
        "select distinct first_seen_at from vehicle",
      );
      expect(firstSeen.rows.map((row) => row.first_seen_at)).toEqual([
        commitStartedAt.getTime(),
      ]);
      // The last batch publishes the source's yard summary with it.
      expect(await yardInventoryRows(client)).toEqual([
        { source: "pyp", code: "yard-1", count: 1_200 },
      ]);
    } finally {
      client.close();
    }
  });

  test("moves a taken-over VIN out of its previous source's yard summary", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const database = drizzle(client);
      const startedAt = new Date("2026-08-22T07:00:00.000Z");
      // pyp owns the VIN until a higher-priority row52 run publishes it.
      await client.execute({
        sql: `insert into vehicle (
          vin, source, year, make, model, location_code, location_name,
          location_city, state, state_abbr, lat, lng, first_seen_at,
          last_seen_at, missing_run_count
        ) values ('VIN-1', 'pyp', 2018, 'FORD', 'FOCUS', 'yard-1', 'Yard 1',
          'Tulsa', 'Oklahoma', 'OK', 36.1, -95.9, ?, ?, 0)`,
        args: [startedAt.getTime(), startedAt.getTime()],
      });
      await client.execute(`insert into yard_inventory values
        ('pyp', 'yard-1', 'Yard 1', 'Tulsa', 'OK', 36.1, -95.9, 1, null, 0)`);
      await database.insert(ingestionRun).values({
        id: "run-row52",
        source: "row52",
        status: "running",
        stage: "reconcile_upsert",
        activeSlot: 1,
        acceptedSources: JSON.stringify(["row52"]),
        startedAt,
        lastProgressAt: startedAt,
      });
      await database.insert(ingestionSourceRun).values({
        id: "run-row52:row52",
        runId: "run-row52",
        source: "row52",
        status: "success",
        acceptanceStatus: "accepted",
        uniqueVehicles: 1,
        startedAt,
      });
      const snapshotStore = IngestionSnapshotStore.memory();
      await stageSnapshots({
        client,
        store: snapshotStore,
        runId: "run-row52",
        vehicles: [snapshot("row52", "Black")],
      });

      const upsert = await reconcileDurableIngestionRun({
        runId: "run-row52",
        database,
        batchClient: client,
        snapshotStore,
        budgetMs: 0,
      });
      expect(upsert).toMatchObject({ status: "paused", phase: "missing" });
      expect(await yardInventoryRows(client)).toEqual([]);

      const completed = await reconcileDurableIngestionRun({
        runId: "run-row52",
        database,
        batchClient: client,
        snapshotStore,
        budgetMs: 0,
      });
      expect(completed.status).toBe("complete");
      expect(await yardInventoryRows(client)).toEqual([
        { source: "row52", code: "yard-1", count: 1 },
      ]);
    } finally {
      client.close();
    }
  });

  test("withdraws a retired source's vehicles through other sources' runs", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const database = drizzle(client);
      const seededAt = new Date("2026-11-15T07:00:00.000Z");
      // upullitne is retired: it never runs again, so only other sources'
      // runs can retire its frozen rows.
      await client.execute({
        sql: `insert into vehicle (
          vin, source, year, make, model, location_code, location_name,
          location_city, state, state_abbr, lat, lng, first_seen_at,
          last_seen_at, missing_run_count
        ) values ('VIN-NE-1', 'upullitne', 2012, 'HONDA', 'CIVIC', 'LINCOLN',
          'Lincoln', 'Lincoln', 'Nebraska', 'NE', 40.8, -96.7, ?, ?, 0)`,
        args: [seededAt.getTime(), seededAt.getTime()],
      });
      await client.execute(`insert into yard_inventory values
        ('upullitne', 'LINCOLN', 'Lincoln', 'Lincoln', 'NE', 40.8, -96.7, 1, null, 0)`);
      const snapshotStore = IngestionSnapshotStore.memory();

      const states = [];
      for (const attempt of [1, 2, 3]) {
        const runId = `run-row52-${attempt}`;
        const startedAt = new Date(seededAt.getTime() + attempt * 3_600_000);
        await database.insert(ingestionRun).values({
          id: runId,
          source: "row52",
          status: "running",
          stage: "reconcile_upsert",
          activeSlot: 1,
          acceptedSources: JSON.stringify(["row52"]),
          startedAt,
          lastProgressAt: startedAt,
        });
        await database.insert(ingestionSourceRun).values({
          id: `${runId}:row52`,
          runId,
          source: "row52",
          status: "success",
          acceptanceStatus: "accepted",
          uniqueVehicles: 1,
          startedAt,
        });
        await stageSnapshots({
          client,
          store: snapshotStore,
          runId,
          vehicles: [snapshot("row52", "Black")],
        });
        const result = await reconcileDurableIngestionRun({
          runId,
          database,
          batchClient: client,
          snapshotStore,
        });
        expect(result.status).toBe("complete");
        const retired = await client.execute(
          "select missing_run_count from vehicle where vin = 'VIN-NE-1'",
        );
        const changes = await client.execute({
          sql: "select vin, change_type from vehicle_change_v2 where run_id = ? and vin = 'VIN-NE-1'",
          args: [runId],
        });
        states.push({
          missingRunCount: retired.rows[0]?.missing_run_count ?? "deleted",
          changes: changes.rows.map((row) => row.change_type),
        });
        // The yard leaves the summary as soon as its vehicles go missing.
        expect(await yardInventoryRows(client)).toEqual([
          { source: "row52", code: "yard-1", count: 1 },
        ]);
      }

      // Missing vehicles stay searchable with a badge; the third run deletes
      // the row and queues the search deletion.
      expect(states).toEqual([
        { missingRunCount: 1, changes: ["missing"] },
        { missingRunCount: 2, changes: ["missing"] },
        { missingRunCount: "deleted", changes: ["delete"] },
      ]);
    } finally {
      client.close();
    }
  });

  test.each(["gopullit", "autorecycler"] as const)(
    "lets %s take over a retired source's VIN",
    async (source) => {
      const client = createClient({ url: ":memory:" });
      try {
        await client.executeMultiple(TEST_SCHEMA);
        const database = drizzle(client);
        const startedAt = new Date("2026-11-15T08:00:00.000Z");
        // upullitne outranks gopullit, but a retired owner must not keep the
        // VIN from a source that still lists it.
        await client.execute({
          sql: `insert into vehicle (
          vin, source, year, make, model, location_code, location_name,
          location_city, state, state_abbr, lat, lng, first_seen_at,
          last_seen_at, missing_run_count
        ) values ('VIN-1', 'upullitne', 2018, 'FORD', 'FOCUS', 'LINCOLN',
          'Lincoln', 'Lincoln', 'Nebraska', 'NE', 40.8, -96.7, ?, ?, 0)`,
          args: [startedAt.getTime(), startedAt.getTime()],
        });
        await client.execute(`insert into yard_inventory values
        ('upullitne', 'LINCOLN', 'Lincoln', 'Lincoln', 'NE', 40.8, -96.7, 1, null, 0)`);
        await database.insert(ingestionRun).values({
          id: "run-gopullit",
          source,
          status: "running",
          stage: "reconcile_upsert",
          activeSlot: 1,
          acceptedSources: JSON.stringify([source]),
          startedAt,
          lastProgressAt: startedAt,
        });
        await database.insert(ingestionSourceRun).values({
          id: `run-gopullit:${source}`,
          runId: "run-gopullit",
          source,
          status: "success",
          acceptanceStatus: "accepted",
          uniqueVehicles: 1,
          startedAt,
        });
        const snapshotStore = IngestionSnapshotStore.memory();
        await stageSnapshots({
          client,
          store: snapshotStore,
          runId: "run-gopullit",
          vehicles: [snapshot(source, "Black")],
        });

        const result = await reconcileDurableIngestionRun({
          runId: "run-gopullit",
          database,
          batchClient: client,
          snapshotStore,
        });
        expect(result.status).toBe("complete");
        const owner = await client.execute(
          "select source, missing_run_count from vehicle where vin = 'VIN-1'",
        );
        expect(
          owner.rows.map((row) => ({
            source: row.source,
            missing_run_count: row.missing_run_count,
          })),
        ).toEqual([{ source, missing_run_count: 0 }]);
        expect(await yardInventoryRows(client)).toEqual([
          { source, code: "yard-1", count: 1 },
        ]);
      } finally {
        client.close();
      }
    },
  );

  test("chooses the canonical winner, resumes by phase, and advances missing state", async () => {
    const directory = mkdtempSync(join(tmpdir(), "reconciliation-test-"));
    const client = createClient({ url: `file:${join(directory, "test.db")}` });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const database = drizzle(client);
      const startedAt = new Date("2026-08-22T07:00:00.000Z");
      await database.insert(ingestionRun).values({
        id: "run-1",
        source: "all",
        status: "running",
        stage: "reconcile_upsert",
        activeSlot: 1,
        acceptedSources: JSON.stringify(["row52", "pyp"]),
        startedAt,
        lastProgressAt: startedAt,
      });
      await database.insert(ingestionSourceRun).values([
        {
          id: "run-1:row52",
          runId: "run-1",
          source: "row52",
          status: "success",
          acceptanceStatus: "accepted",
          uniqueVehicles: 1,
          startedAt,
        },
        {
          id: "run-1:pyp",
          runId: "run-1",
          source: "pyp",
          status: "success",
          acceptanceStatus: "accepted",
          uniqueVehicles: 1,
          startedAt,
        },
      ]);
      const snapshotStore = IngestionSnapshotStore.memory();
      await stageSnapshots({
        client,
        store: snapshotStore,
        runId: "run-1",
        vehicles: [snapshot("pyp", "Blue"), snapshot("row52", "Black")],
      });
      await client.execute({
        sql: `insert into vehicle (
          vin, source, year, make, model, location_code, location_name,
          location_city, state, state_abbr, lat, lng, first_seen_at,
          last_seen_at, missing_run_count
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "VIN-MISSING",
          "pyp",
          2010,
          "HONDA",
          "CIVIC",
          "yard-2",
          "Yard 2",
          "Tulsa",
          "Oklahoma",
          "OK",
          36.1,
          -95.9,
          startedAt.getTime(),
          startedAt.getTime(),
          0,
        ],
      });

      const upsert = await reconcileDurableIngestionRun({
        runId: "run-1",
        database,
        batchClient: client,
        snapshotStore,
        budgetMs: 0,
      });
      expect(upsert).toMatchObject({ status: "paused", phase: "missing" });

      const completed = await reconcileDurableIngestionRun({
        runId: "run-1",
        database,
        batchClient: client,
        snapshotStore,
        budgetMs: 0,
      });
      expect(completed.status).toBe("complete");
      const vehicles = await client.execute(
        "select vin, source, color, missing_run_count from vehicle order by vin",
      );
      expect(vehicles.rows).toHaveLength(2);
      expect(vehicles.rows[0]?.vin).toBe("VIN-1");
      expect(vehicles.rows[0]?.source).toBe("row52");
      expect(vehicles.rows[0]?.color).toBe("Black");
      expect(vehicles.rows[0]?.missing_run_count).toBe(0);
      expect(vehicles.rows[1]?.vin).toBe("VIN-MISSING");
      expect(vehicles.rows[1]?.source).toBe("pyp");
      expect(vehicles.rows[1]?.missing_run_count).toBe(1);
      const [run] = await database
        .select()
        .from(ingestionRun)
        .where(eq(ingestionRun.id, "run-1"));
      expect(run?.stage).toBe("project_changes");
      expect(run?.publicationSequence).toBe(1);
      expect(run?.publishedVehicleCount).toBe(2);
      const changes = await client.execute(
        "select vin, change_type from vehicle_change_v2 order by vin",
      );
      expect(changes.rows).toHaveLength(2);
      expect(changes.rows[0]?.vin).toBe("VIN-1");
      expect(changes.rows[0]?.change_type).toBe("upsert");
      expect(changes.rows[1]?.vin).toBe("VIN-MISSING");
      expect(changes.rows[1]?.change_type).toBe("missing");
      // A missing vehicle leaves its yard's live count.
      expect(await yardInventoryRows(client)).toEqual([
        { source: "row52", code: "yard-1", count: 1 },
      ]);
    } finally {
      client.close();
      rmSync(directory, { recursive: true });
    }
  });
});

test("missing reconciliation reads accepted and retired sources, including resumed VIN pages", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(TEST_SCHEMA);
    const store = IngestionSnapshotStore.memory();
    await drizzle(client).insert(ingestionRun).values({
      id: "scoped",
      source: "pyp",
      status: "running",
      stage: "reconcile_missing",
      activeSlot: 1,
      acceptedSources: '["pyp"]',
      reconciliationCursor: "A",
      startedAt: new Date(),
      lastProgressAt: new Date(),
    });
    await client.executeMultiple(`
      insert into vehicle (vin, source, year, make, model, location_code, location_name, location_city, state, state_abbr, lat, lng, first_seen_at, last_seen_at)
      values ('B', 'pyp', 2000, 'Ford', 'Focus', '1', 'Yard', 'City', 'Oklahoma', 'OK', 0, 0, 0, 0),
             ('C', 'row52', 2000, 'Ford', 'Focus', '1', 'Yard', 'City', 'Oklahoma', 'OK', 0, 0, 0, 0);
    `);
    const reads: string[] = [];
    const database = drizzle(client, {
      logger: {
        logQuery(query) {
          if (query.startsWith("select") && query.includes('from "vehicle"'))
            reads.push(query);
        },
      },
    });
    const result = await reconcileDurableIngestionRun({
      runId: "scoped",
      database,
      batchClient: client,
      snapshotStore: store,
      budgetMs: 0,
    });
    expect(result.status).toBe("complete");
    expect(
      (
        await client.execute(
          "select vin, missing_run_count from vehicle order by vin",
        )
      ).rows,
    ).toMatchObject([
      { vin: "B", missing_run_count: 1 },
      { vin: "C", missing_run_count: null },
    ]);
    // One placeholder for the accepted source plus one per retired source.
    const scopedSources = ["pyp", ...RETIRED_INGESTION_SOURCES]
      .map(() => "?")
      .join(", ");
    expect(
      reads.some(
        (query) =>
          query.includes(`"vehicle"."source" in (${scopedSources})`) &&
          query.includes('"vehicle"."vin" > ?'),
      ),
    ).toBe(true);
  } finally {
    client.close();
  }
});

test("source-scoped missing scans preserve observations of another source's VIN across pages of unknown VINs", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(TEST_SCHEMA);
    const database = drizzle(client);
    const store = IngestionSnapshotStore.memory();
    const startedAt = new Date();
    await database.insert(ingestionRun).values({
      id: "observed-owner",
      source: "pyp",
      status: "running",
      stage: "reconcile_missing",
      activeSlot: 1,
      acceptedSources: '["pyp"]',
      startedAt,
      lastProgressAt: startedAt,
    });
    const pathname = await store.put({
      runId: "observed-owner",
      source: "pyp",
      chunk: {
        vehicles: [],
        observedVins: [
          ...Array.from(
            { length: 501 },
            (_, index) => `A-${String(index).padStart(4, "0")}`,
          ),
          "C",
        ],
      },
    });
    await database.insert(ingestionSourceRun).values({
      id: "observed-owner:pyp",
      runId: "observed-owner",
      source: "pyp",
      status: "success",
      acceptanceStatus: "accepted",
      snapshotChunks: JSON.stringify([pathname]),
      startedAt,
    });
    await client.executeMultiple(`
      insert into vehicle (vin, source, year, make, model, location_code, location_name, location_city, state, state_abbr, lat, lng, first_seen_at, last_seen_at, missing_since_at, missing_run_count)
      values ('B', 'pyp', 2000, 'Ford', 'Focus', '1', 'Yard', 'City', 'Oklahoma', 'OK', 0, 0, 0, 0, null, 0),
             ('C', 'row52', 2000, 'Ford', 'Focus', '1', 'Yard', 'City', 'Oklahoma', 'OK', 0, 0, 123, 123, 123, 2);
    `);
    for (let batch = 0; batch < 3; batch += 1) {
      const result = await reconcileDurableIngestionRun({
        runId: "observed-owner",
        database,
        batchClient: client,
        snapshotStore: store,
        budgetMs: 0,
      });
      if (result.status === "complete") break;
    }
    expect(
      (
        await client.execute(
          "select vin, missing_run_count, first_seen_at from vehicle order by vin",
        )
      ).rows,
    ).toMatchObject([
      { vin: "B", missing_run_count: 1, first_seen_at: 0 },
      { vin: "C", missing_run_count: 0, first_seen_at: 123 },
    ]);
    expect(
      (
        await client.execute(
          "select vin, change_type from vehicle_change_v2 order by vin",
        )
      ).rows,
    ).toMatchObject([
      { vin: "B", change_type: "missing" },
      { vin: "C", change_type: "upsert" },
    ]);
  } finally {
    client.close();
  }
});
