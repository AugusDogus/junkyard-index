import { createClient } from "@libsql/client";
import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import { reconcileDurableIngestionRun } from "./durable-reconciliation";
import { RECONCILIATION_TEST_SCHEMA } from "./durable-reconciliation-test-fixtures";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import type { CanonicalVehicle } from "./types";

function vehicle(vin: string): CanonicalVehicle {
  return {
    source: "pyp",
    vin,
    year: 2018,
    make: "FORD",
    model: "FOCUS",
    color: "Blue",
    stockNumber: null,
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

/** A memory store that counts loads and can make each one take workflow time. */
function countingStore(onLoad: () => void = () => undefined) {
  const store = IngestionSnapshotStore.memory();
  let loads = 0;
  const counted: IngestionSnapshotStore = {
    put: (params) => store.put(params),
    delete: (pathnames) => store.delete(pathnames),
    async load(pathname) {
      loads += 1;
      onLoad();
      return store.load(pathname);
    },
  };
  return { store: counted, loads: () => loads };
}

async function stagedRun(params: {
  store: IngestionSnapshotStore;
  runId: string;
  vehicles: number;
}) {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
  const database = drizzle(client);
  const now = new Date();
  await database.insert(ingestionRun).values({
    id: params.runId,
    source: "pyp",
    status: "running",
    stage: "reconcile_upsert",
    activeSlot: 1,
    commitStartedAt: now,
    acceptedSources: JSON.stringify(["pyp"]),
    startedAt: now,
    lastProgressAt: now,
  });
  const pathname = await params.store.put({
    runId: params.runId,
    source: "pyp",
    chunk: {
      vehicles: Array.from({ length: params.vehicles }, (_, index) =>
        vehicle(`V-${String(index).padStart(5, "0")}`),
      ),
      observedVins: [],
    },
  });
  await database.insert(ingestionSourceRun).values({
    id: `${params.runId}:pyp`,
    runId: params.runId,
    source: "pyp",
    status: "success",
    acceptanceStatus: "accepted",
    uniqueVehicles: params.vehicles,
    snapshotChunks: JSON.stringify([pathname]),
    startedAt: now,
  });
  return { client, database };
}

afterEach(() => {
  setSystemTime();
});

describe("reconciliation step budget", () => {
  test("loading the staged inventory does not use up the step's batch budget", async () => {
    // Each load takes two minutes of workflow time, longer than the budget.
    const { store, loads } = countingStore(() =>
      setSystemTime(new Date(Date.now() + 120_000)),
    );
    const { client, database } = await stagedRun({
      store,
      runId: "slow-load",
      vehicles: 1_200,
    });
    try {
      const result = await reconcileDurableIngestionRun({
        runId: "slow-load",
        database,
        batchClient: client,
        snapshotStore: store,
        budgetMs: 60_000,
      });
      expect(result.status).toBe("complete");
      expect(loads()).toBe(1);
      expect(
        (await client.execute("select count(*) as count from vehicle")).rows[0]
          ?.count,
      ).toBe(1_200);
    } finally {
      client.close();
    }
  });

  test("the run's next step reuses the inventory its last step loaded", async () => {
    const { store, loads } = countingStore();
    const { client, database } = await stagedRun({
      store,
      runId: "reused",
      vehicles: 1_200,
    });
    try {
      const step = () =>
        reconcileDurableIngestionRun({
          runId: "reused",
          database,
          batchClient: client,
          snapshotStore: store,
          budgetMs: 0,
        });
      let result = await step();
      let steps = 1;
      while (result.status === "paused") {
        result = await step();
        steps += 1;
      }
      expect(steps).toBeGreaterThan(2);
      expect(loads()).toBe(1);
      expect(
        (await client.execute("select count(*) as count from vehicle")).rows[0]
          ?.count,
      ).toBe(1_200);
    } finally {
      client.close();
    }
  });

  test("a different run or staged snapshot loads its own inventory", async () => {
    const { store, loads } = countingStore();
    const first = await stagedRun({ store, runId: "first", vehicles: 3 });
    const second = await stagedRun({ store, runId: "second", vehicles: 2 });
    try {
      for (const [runId, { client, database }] of [
        ["first", first],
        ["second", second],
      ] as const) {
        await reconcileDurableIngestionRun({
          runId,
          database,
          batchClient: client,
          snapshotStore: store,
        });
      }
      expect(loads()).toBe(2);
      expect(
        (await second.client.execute("select count(*) as count from vehicle"))
          .rows[0]?.count,
      ).toBe(2);
    } finally {
      first.client.close();
      second.client.close();
    }
  });
});
