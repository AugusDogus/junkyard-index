import { RECONCILIATION_TEST_SCHEMA } from "./durable-reconciliation-test-fixtures";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { vehicle, ingestionRun, ingestionSourceRun } from "~/schema";
import {
  compileAlertFilters,
  scanAlertMatchPages,
} from "~/lib/algolia-alert-search";
import { canMatchSettledIngestionAlerts } from "~/server/alerts/settled-ingestion-alerts";
import {
  createTestClient,
  makeVehicle,
} from "./durable-ingestion-test-fixtures";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { reconcileDurableIngestionRun } from "./durable-reconciliation";

const now = new Date("2026-11-17T12:00:00Z");

test("an early marketplace VIN alerts only under its final native owner, and same-day missing VINs are excluded", async () => {
  const { client, cleanup } = createTestClient();
  try {
    await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
    const database = drizzle(client);
    const store = IngestionSnapshotStore.memory();
    const original = {
      ...makeVehicle("DUPLICATE"),
      source: "autorecycler" as const,
    };
    await database.insert(vehicle).values({
      ...original,
      firstSeenAt: now,
      lastSeenAt: now,
      missingRunCount: 0,
    });
    await database.insert(vehicle).values({
      ...original,
      vin: "DISAPPEARED",
      firstSeenAt: now,
      lastSeenAt: now,
      missingSinceAt: now,
      missingRunCount: 1,
    });
    for (const [id, source, stage] of [
      ["market", "autorecycler", "match_alerts"],
      ["native", "pontiac", "sources"],
    ] as const) {
      await database.insert(ingestionRun).values({
        id,
        source,
        stage,
        status: "running",
        activeSlot: 1,
        scheduleKey: "2026-11-17",
        searchPublishedAt: id === "market" ? now : null,
        startedAt: now,
        lastProgressAt: now,
      });
      await database.insert(ingestionSourceRun).values({
        id: id + ":" + source,
        runId: id,
        source,
        status: "success",
        acceptanceStatus: "accepted",
        startedAt: now,
      });
    }
    expect(await canMatchSettledIngestionAlerts(database, "market", now)).toBe(
      false,
    );
    await client.execute(
      "update ingestion_run set stage = 'released', status = 'success', active_slot = null where id = 'market'",
    );
    const native = { ...original, source: "pontiac" as const };
    const path = await store.put({
      runId: "native",
      source: "pontiac",
      chunk: { vehicles: [native], observedVins: [] },
    });
    await client.execute({
      sql: "update ingestion_source_run set snapshot_chunks = ? where run_id = 'native'",
      args: [JSON.stringify([path])],
    });
    await client.execute(
      "update ingestion_run set stage = 'reconcile_upsert', accepted_sources = '[\"pontiac\"]' where id = 'native'",
    );
    expect(
      (
        await reconcileDurableIngestionRun({
          runId: "native",
          database,
          batchClient: client,
          snapshotStore: store,
        })
      ).status,
    ).toBe("complete");
    await client.execute({
      sql: "update ingestion_run set stage = 'match_alerts', search_published_at = ? where id = 'native'",
      args: [now.getTime()],
    });
    expect(await canMatchSettledIngestionAlerts(database, "native", now)).toBe(
      true,
    );
    const rows = await database.select().from(vehicle);
    expect(rows.find((row) => row.vin === "DUPLICATE")).toMatchObject({
      source: "pontiac",
      firstSeenAt: now,
      missingRunCount: 0,
    });
    // Match the final source, then run the production alert scanner over its
    // projected records. The retained same-day disappearance is not an alert.
    for (const source of ["autorecycler", "pontiac"]) {
      expect(compileAlertFilters({ sources: [source] }, null)).toEqual({
        kind: "filter",
        value: `source:"${source}"`,
      });
      const hits = rows
        .filter((row) => row.source === source)
        .map((row) => ({ ...row, objectID: row.vin }));
      const matched = await scanAlertMatchPages(
        async () => ({
          hits,
          reportedCount: hits.length,
          reportedPageCount: 1,
          countIsExhaustive: true,
        }),
        { hitsPerPage: 100, paginationLimit: 100 },
      );
      expect(matched.matchedCount).toBe(source === "pontiac" ? 1 : 0);
      expect(matched.vehicles.map((row) => row.vin)).toEqual(
        source === "pontiac" ? ["DUPLICATE"] : [],
      );
    }
  } finally {
    cleanup();
  }
});

test("a quarantined Ario yard keeps its inventory and missing counters while healthy yards reconcile", async () => {
  const { client, cleanup } = createTestClient();
  try {
    await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
    const database = drizzle(client);
    const store = IngestionSnapshotStore.memory();
    const base = {
      ...makeVehicle("QUARANTINED"),
      source: "autorecycler" as const,
      locationCode: "bad-yard",
    };
    for (const [vin, code, missing] of [
      ["QUARANTINED", "bad-yard", 0],
      ["ALREADY-MISSING", "bad-yard", 2],
      ["HEALTHY-ABSENT", "good-yard", 0],
    ] as const) {
      await database.insert(vehicle).values({
        ...base,
        vin,
        locationCode: code,
        firstSeenAt: now,
        lastSeenAt: now,
        missingSinceAt: missing
          ? new Date(now.getTime() - 3 * 86400_000)
          : null,
        missingRunCount: missing,
      });
    }
    await database.insert(ingestionRun).values({
      id: "ario",
      source: "autorecycler",
      status: "running",
      stage: "reconcile_upsert",
      activeSlot: 1,
      acceptedSources: '["autorecycler"]',
      startedAt: now,
      lastProgressAt: now,
    });
    const path = await store.put({
      runId: "ario",
      source: "autorecycler",
      chunk: {
        vehicles: [{ ...base, vin: "HEALTHY-NEW", locationCode: "good-yard" }],
        observedVins: [],
      },
    });
    await database.insert(ingestionSourceRun).values({
      id: "ario:autorecycler",
      runId: "ario",
      source: "autorecycler",
      status: "success",
      acceptanceStatus: "accepted",
      snapshotChunks: JSON.stringify([path]),
      nextCursor: JSON.stringify({
        phase: "complete",
        freshness: {
          asOf: now.getTime(),
          legacy: {},
          eligibleYards: ["good-yard"],
          preservedYards: ["bad-yard"],
        },
      }),
      startedAt: now,
    });
    expect(
      (
        await reconcileDurableIngestionRun({
          runId: "ario",
          database,
          batchClient: client,
          snapshotStore: store,
        })
      ).status,
    ).toBe("complete");
    const rows = await database.select().from(vehicle);
    expect(rows.find((row) => row.vin === "QUARANTINED")).toMatchObject({
      missingSinceAt: null,
      missingRunCount: 0,
      lastSeenAt: now,
    });
    expect(rows.find((row) => row.vin === "ALREADY-MISSING")).toMatchObject({
      missingRunCount: 2,
      lastSeenAt: now,
    });
    expect(
      rows.find((row) => row.vin === "HEALTHY-ABSENT")?.missingRunCount,
    ).toBe(1);
    expect(rows.find((row) => row.vin === "HEALTHY-NEW")?.missingRunCount).toBe(
      0,
    );
  } finally {
    cleanup();
  }
});

test("a quarantined customer yard cannot make healthy AutoRecycler inventory fail the shrinkage guard", async () => {
  const { client, cleanup } = createTestClient();
  try {
    await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
    const database = drizzle(client);
    const { ARIO_CUSTOMER_YARDS, arioLocationCode } =
      await import("./autorecycler-ario-yards");
    const { validateAutorecyclerPublishedInventory } =
      await import("./autorecycler-published-inventory");
    const bad = arioLocationCode(ARIO_CUSTOMER_YARDS[0]);
    const healthy = arioLocationCode(ARIO_CUSTOMER_YARDS[1]);
    for (const [vin, locationCode] of [
      ["BAD-1", bad],
      ["BAD-2", bad],
      ["GOOD", healthy],
    ] as const) {
      await database.insert(vehicle).values({
        ...makeVehicle(vin),
        source: "autorecycler",
        locationCode,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }
    const current = [
      {
        ...makeVehicle("GOOD"),
        source: "autorecycler" as const,
        locationCode: healthy,
      },
    ];
    expect(
      (
        await validateAutorecyclerPublishedInventory(database, current, [
          healthy,
        ])
      ).errors,
    ).toHaveLength(1);
    expect(
      await validateAutorecyclerPublishedInventory(
        database,
        current,
        [healthy],
        [bad],
      ),
    ).toEqual({ previousEligibleCount: 1, errors: [] });
  } finally {
    cleanup();
  }
});
