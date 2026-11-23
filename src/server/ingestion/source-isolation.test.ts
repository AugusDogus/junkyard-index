import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import { RECONCILIATION_TEST_SCHEMA } from "./durable-reconciliation-test-fixtures";
import { validateDurableSourceRuns } from "./durable-source-validation";
import { reconcileDurableIngestionRun } from "./durable-reconciliation";
import { serializeDurableSourceCursor } from "./durable-source";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { makeVehicle } from "./durable-ingestion-test-fixtures";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { UrgiisCursor } from "./urgiis-cursor";

const birmingham =
  "1348695171700984260__LOOKUP__1780608885295x623625493214308200";
const santaMaria =
  "1348695171700984260__LOOKUP__1668532737669x351011199612092400";
const santaPaula =
  "1348695171700984260__LOOKUP__1667997988609x651574054625214500";

test.each(
  (["autorecycler", "urgiis"] as const).flatMap((source) =>
    (["none", "floor", "drift", "rejection", "duplicates"] as const).map(
      (guard) => ({ source, guard }),
    ),
  ),
)(
  "publishes only complete healthy yards with unchanged guards (%j)",
  async ({ source, guard }) => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
      const database = drizzle(client);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        database,
        client,
        snapshotStore,
      );
      const runId = "yard-isolation";
      await repository.initialize(runId, async () => [source]);
      const healthy = URGIIS_TENANTS.find(
        (tenant) => tenant.code === "higgins",
      );
      if (!healthy) throw new Error("Missing Higgins fixture");
      const code = source === "autorecycler" ? "healthy" : healthy.yard.code;
      const preserved = source === "autorecycler" ? birmingham : "linders";
      const floor = source === "autorecycler" ? 100 : healthy.minimumInventory;
      const count = floor - (guard === "floor" ? 1 : 0);
      const first = UrgiisCursor.initial();
      const cursor =
        source === "autorecycler"
          ? {
              source,
              phase: "complete" as const,
              freshness: {
                asOf: Date.now(),
                legacy: {},
                eligibleYards: [code],
                preservedYards: [preserved],
              },
            }
          : UrgiisCursor.checkpoint({
              source,
              version: first.version,
              scope: first.scope,
              startedAt: null,
              asOf: null,
              statePath: null,
              stateHash: null,
              requests: 0,
              bytes: 0,
              phase: "complete",
              completed: URGIIS_TENANTS.map((tenant) =>
                tenant === healthy
                  ? { code: tenant.code, accepted: floor }
                  : {
                      code: tenant.code,
                      blocked: "Supplier identity mismatch",
                    },
              ),
            });
      const vehicles = Array.from({ length: count }, (_, index) => ({
        ...makeVehicle(`NEW-${index}`),
        source,
        locationCode: code,
      }));
      const path = await snapshotStore.put({
        runId,
        source,
        chunk: { vehicles, observedVins: [] },
      });
      await client.execute({
        sql: "update ingestion_source_run set status = 'success', vehicles_processed = ?, snapshot_chunks = ?, next_cursor = ? where run_id = ?",
        args: [
          count,
          JSON.stringify([path]),
          serializeDurableSourceCursor(cursor),
          runId,
        ],
      });
      for (const [vin, yard, date, missing, runs] of [
        ["PRESERVED", preserved, "2026-11-01", 1, 2],
        ["STALE-MARIA", santaMaria, "2026-08-19", null, 0],
        ["STALE-PAULA", santaPaula, "2022-07-19", null, 0],
      ] as const) {
        if (source === "urgiis" && yard !== preserved) continue;
        await client.execute({
          sql: "insert into vehicle (vin, source, year, make, model, location_code, location_name, location_city, state, state_abbr, lat, lng, first_seen_at, last_seen_at, available_date, missing_since_at, missing_run_count) values (?, ?, 2000, 'Ford', 'Focus', ?, 'Saved Yard', 'City', 'California', 'CA', 1, 1, 1, 1, ?, ?, ?)",
          args: [vin, source, yard, date, missing, runs],
        });
      }
      await client.execute({
        sql: `with recursive numbers(n) as (select 1 union all select n+1 from numbers where n < 500)
      insert into vehicle (vin, source, year, make, model, location_code, location_name, location_city, state, state_abbr, lat, lng, first_seen_at, last_seen_at, missing_run_count)
      select 'BLOCKED-' || n, ?, 2000, 'Ford', 'Focus', ?, 'Saved Yard', 'City', 'California', 'CA', 1, 1, 1, 1, 0 from numbers`,
        args: [source, preserved],
      });
      const priorHealthy = guard === "drift" ? count * 2 + 1 : 2;
      await client.execute({
        sql: `with recursive numbers(n) as (select 1 union all select n+1 from numbers where n < ?)
      insert into vehicle (vin, source, year, make, model, location_code, location_name, location_city, state, state_abbr, lat, lng, first_seen_at, last_seen_at, missing_run_count)
      select 'OLD-HEALTHY-' || n, ?, 2000, 'Ford', 'Focus', ?, 'Saved Yard', 'City', 'California', 'CA', 1, 1, 1, 1, 0 from numbers`,
        args: [priorHealthy, source, code],
      });
      if (guard === "rejection" || guard === "duplicates") {
        const rejected = guard === "rejection" ? Math.ceil(count * 0.12) : 0;
        const duplicates = guard === "duplicates" ? Math.ceil(count * 0.4) : 0;
        await client.execute({
          sql: "update ingestion_source_run set vehicles_processed = ?, rejected_vehicles = ?, duplicate_vehicles = ? where run_id = ?",
          args: [count + rejected + duplicates, rejected, duplicates, runId],
        });
      }
      const validation = await validateDurableSourceRuns({
        runId,
        database,
        batchClient: client,
        snapshotStore,
      });
      if (guard !== "none") {
        expect(validation).toMatchObject({
          status: "ready",
          acceptedSources: [],
        });
        expect(
          validation.status === "ready" &&
            validation.rejectedSources[0]?.errors.join(" "),
        ).toContain(
          {
            floor: source === "urgiis" ? "yard floor" : "minimum",
            drift: "50% yard drift",
            rejection: "rejection ratio",
            duplicates: "duplicate ratio",
          }[guard],
        );
        return;
      }
      expect(validation).toMatchObject({
        status: "ready",
        acceptedSources: [source],
      });
      expect(
        (
          await reconcileDurableIngestionRun({
            runId,
            database,
            batchClient: client,
            snapshotStore,
          })
        ).status,
      ).toBe("complete");
      expect(
        (
          await client.execute(
            "select last_seen_at, missing_since_at, missing_run_count from vehicle where vin = 'PRESERVED'",
          )
        ).rows[0],
      ).toMatchObject({
        last_seen_at: 1,
        missing_since_at: 1,
        missing_run_count: 2,
      });
      expect(
        (
          await client.execute(
            "select count(*) n from vehicle where vin like 'NEW-%'",
          )
        ).rows[0]?.n,
      ).toBe(count);
      if (source === "autorecycler") {
        const stale = (
          await client.execute(
            "select missing_since_at, missing_run_count from vehicle where vin like 'STALE-%'",
          )
        ).rows;
        expect(stale).toHaveLength(2);
        expect(
          stale.every(
            (row) =>
              row.missing_since_at !== null && row.missing_run_count === 1,
          ),
        ).toBe(true);
      }
    } finally {
      client.close();
    }
  },
);
