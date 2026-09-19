import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestionRun, ingestionSourceRun, vehicleSnapshot } from "~/schema";
import { reconcileDurableIngestionRun } from "./durable-reconciliation";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import { streamPullNSaveInventoryWithRequestGate } from "./pullnsave-connector";
import { connectorChunkMetrics } from "./connector-chunk";
import { Effect } from "effect";
import type { CanonicalVehicle } from "./types";
import { streamAutorecyclerInventoryWithPageFetcher } from "./autorecycler-connector";
import { Database } from "./context";
import { validateDurableSourceRuns } from "./durable-source-validation";

const TEST_SCHEMA = `
${readFileSync(new URL("../../../drizzle/0008_vehicle_observations.sql", import.meta.url), "utf8")}
  create table ingestion_run (
    id text primary key, source text not null, schedule_key text,
    workflow_run_id text, status text not null, stage text not null,
    active_slot integer, reconciliation_cursor text,
    projector_cursor integer not null default 0,
    full_reindex_required integer not null default 0,
    full_reindex_cursor text, full_reindex_move_task_id integer,
    alert_match_cursor text,
    accepted_sources text, inventory_outcome text,
    publication_sequence integer, published_vehicle_count integer,
    published_yard_count integer, vehicles_upserted integer default 0,
    vehicles_deleted integer default 0, errors text, execution_errors text,
    started_at integer not null, last_progress_at integer not null,
    inventory_published_at integer, search_published_at integer,
    alert_matching_completed_at integer, released_at integer,
    completed_at integer
  );
  create table ingestion_source_run (
    id text primary key, run_id text not null, source text not null,
    status text not null, start_cursor text, next_cursor text,
    pages_processed integer not null default 0,
    vehicles_processed integer not null default 0,
    unique_vehicles integer not null default 0,
    duplicate_vehicles integer not null default 0,
    rejected_vehicles integer not null default 0,
    acceptance_status text not null default 'pending',
    validation_errors text, errors text, started_at integer not null,
    completed_at integer
  );
  create table vehicle_snapshot (
    run_id text not null, source text not null, vin text not null,
    year integer not null, make text not null, model text not null,
    color text, stock_number text, image_url text, available_date text,
    location_code text not null, location_name text not null,
    location_city text not null, state text not null, state_abbr text not null,
    lat real not null, lng real not null, section text, row text, space text,
    details_url text, parts_url text, prices_url text, engine text, trim text,
    transmission text, created_at integer not null default 0,
    primary key (run_id, source, vin)
  );
  create table vehicle (
    vin text primary key, source text not null, year integer not null,
    make text not null, model text not null, color text, stock_number text,
    image_url text, available_date text, location_code text not null,
    location_name text not null, location_city text not null, state text not null,
    state_abbr text not null, lat real not null, lng real not null,
    section text, row text, space text, details_url text, parts_url text,
    prices_url text, engine text, trim text, transmission text,
    first_seen_at integer not null, last_seen_at integer not null,
    missing_since_at integer, missing_run_count integer
  );
  create table vehicle_change_v2 (
    id integer primary key autoincrement, run_id text not null, vin text not null,
    change_type text not null, payload text, payload_version integer not null,
    created_at integer not null, processed_at integer
  );
  create unique index vehicle_change_v2_run_vin_type_idx
    on vehicle_change_v2(run_id, vin, change_type)
    where processed_at is null;
`;

function snapshot(runId: string, source: "row52" | "pyp", color: string) {
  return {
    runId,
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
    createdAt: new Date("2026-08-22T07:00:00.000Z"),
  };
}

describe("bounded durable reconciliation", () => {
  test("AutoRecycler preserves unresolved independent VINs across resume but lets excluded mirror VINs retire", async () => {
    const client = createClient({ url: ":memory:" });
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
      },
    };
    let geoRequests = 0;
    const offsets: number[] = [];
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
      const repository = createDurableIngestionRepository(database, client);
      const runId = "run-autorecycler-quarantine";
      await repository.initialize(runId);
      const known = Array.from({ length: 100 }, (_, index) => ({
        _source: {
          organization_custom_organization: knownOrg,
          inventory_id_text: `known-${index}`,
          vin_text: `1HGCM82633A${String(index).padStart(6, "0")}`,
          name_text: "2003 Honda Accord",
        },
      }));
      for (const startFrom of [0, 3]) {
        const vehicles: CanonicalVehicle[] = [];
        const result = await Effect.runPromise(
          streamAutorecyclerInventoryWithPageFetcher(
            {
              startFrom,
              maxPages: 2,
              onBatch: (batch) =>
                Effect.sync(() => {
                  vehicles.push(...batch);
                }),
            },
            async (from) => {
              offsets.push(from);
              const hits =
                from === 0
                  ? [
                      missing,
                      { _source: { ...missing._source, vin_text: "invalid" } },
                    ]
                  : from === 2
                    ? [missing]
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
              return { responses: [{ hits: { hits }, at_end: from === 3 }] };
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
        expect(result.cursor).toBe(startFrom === 0 ? 3 : 108);
        expect(result.observedVins).toEqual([presentVin]);
        expect(result.errors).toEqual([]);
        expect(result.warnings?.join(" ")).toContain(
          "Observed VINs are preserved",
        );
        expect(result.accounting).toEqual(
          startFrom === 0
            ? {
                recordsProcessed: 3,
                recordsExcluded: 3,
                recordsRejected: 0,
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
          requestedCursor: { source: "autorecycler", from: startFrom },
          fetched: {
            cursor: { source: "autorecycler", from: result.cursor },
            status: result.status,
            pagesProcessed: result.pagesProcessed,
            ...connectorChunkMetrics(result, vehicles.length),
            errors: result.errors,
            vehicles,
            yards: [],
            observedVins: result.observedVins ?? [],
          },
        });
      }
      expect(offsets).toEqual([0, 2, 3]);
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
        vehiclesProcessed: 102,
        uniqueVehicles: 100,
        rejectedVehicles: 1,
        duplicateVehicles: 1,
      });
      await reconcileDurableIngestionRun({
        runId,
        database,
        batchClient: client,
      });
      await reconcileDurableIngestionRun({
        runId,
        database,
        batchClient: client,
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
      const repository = createDurableIngestionRepository(database, client);
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
      });
      await reconcileDurableIngestionRun({
        runId: "run-returned",
        database,
        batchClient: client,
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
      const repository = createDurableIngestionRepository(database, client);
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
      await database
        .insert(vehicleSnapshot)
        .values([
          snapshot("run-1", "pyp", "Blue"),
          snapshot("run-1", "row52", "Black"),
        ]);
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
      });
      expect(upsert).toMatchObject({ status: "paused", phase: "missing" });

      const completed = await reconcileDurableIngestionRun({
        runId: "run-1",
        database,
        batchClient: client,
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
    } finally {
      client.close();
      rmSync(directory, { recursive: true });
    }
  });
});
