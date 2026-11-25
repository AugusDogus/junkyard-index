import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { YardCheckReport } from "~/lib/yard-check";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import { reconcileDurableIngestionRun } from "./durable-reconciliation";
import { RECONCILIATION_TEST_SCHEMA } from "./durable-reconciliation-test-fixtures";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import type { CanonicalVehicle } from "./types";

function car(
  vin: string,
  locationCode: string,
  color = "Blue",
): CanonicalVehicle {
  return {
    source: "pyp",
    vin,
    year: 2018,
    make: "FORD",
    model: "FOCUS",
    color,
    stockNumber: vin,
    imageUrl: null,
    availableDate: null,
    locationCode,
    locationName: locationCode,
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

type SourceRun = {
  source: "pyp" | "row52";
  acceptance: "accepted" | "rejected";
  vehicles: CanonicalVehicle[];
  yardChecks: YardCheckReport[];
};

async function harness() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
  const database = drizzle(client);
  const store = IngestionSnapshotStore.memory();

  async function publish(id: string, at: Date, runs: SourceRun[]) {
    await database.insert(ingestionRun).values({
      id,
      source: "pyp",
      status: "running",
      stage: "reconcile_upsert",
      activeSlot: 1,
      commitStartedAt: at,
      acceptedSources: JSON.stringify(
        runs
          .filter((run) => run.acceptance === "accepted")
          .map((r) => r.source),
      ),
      startedAt: at,
      lastProgressAt: at,
    });
    for (const run of runs) {
      const pathname = await store.put({
        runId: id,
        source: run.source,
        chunk: {
          vehicles: run.vehicles,
          observedVins: [],
          yardChecks: run.yardChecks,
        },
      });
      await database.insert(ingestionSourceRun).values({
        id: `${id}:${run.source}`,
        runId: id,
        source: run.source,
        status: "success",
        acceptanceStatus: run.acceptance,
        uniqueVehicles: run.vehicles.length,
        snapshotChunks: JSON.stringify([pathname]),
        startedAt: at,
      });
    }
    let result = await reconcileDurableIngestionRun({
      runId: id,
      database,
      batchClient: client,
      snapshotStore: store,
      budgetMs: 0,
    });
    while (result.status === "paused")
      result = await reconcileDurableIngestionRun({
        runId: id,
        database,
        batchClient: client,
        snapshotStore: store,
        budgetMs: 0,
      });
    expect(result.status).toBe("complete");
    await database
      .update(ingestionRun)
      .set({ activeSlot: null })
      .where(eq(ingestionRun.id, id));
  }

  async function checks() {
    const result = await client.execute(
      "select * from yard_check order by source, location_code",
    );
    return result.rows.map((row) => ({
      yard: `${row.source}:${row.location_code}`,
      outcome: row.outcome,
      reportedAt: row.reported_at,
      reportedRunId: row.reported_run_id,
      lastCheckedAt: row.last_checked_at,
      lastCheckedRunId: row.last_checked_run_id,
      lastChangedAt: row.last_changed_at,
      lastArrivalAt: row.last_arrival_at,
      consecutiveUncheckedRuns: row.consecutive_unchecked_runs,
    }));
  }

  return { client, publish, checks };
}

const first = new Date("2026-11-20T07:00:00Z");
const second = new Date("2026-11-21T07:00:00Z");
const third = new Date("2026-11-22T07:00:00Z");

describe("yard check records", () => {
  test("only a fetched result advances a yard's last check; listed yards nobody reported are unreported", async () => {
    const { client, publish, checks } = await harness();
    try {
      const cars = [
        car("A-1", "tulsa"),
        car("A-2", "tulsa"),
        car("B-1", "okc"),
      ];
      await publish("run-1", first, [
        {
          source: "pyp",
          acceptance: "accepted",
          vehicles: cars,
          yardChecks: [{ locationCode: "tulsa", outcome: "fetched" }],
        },
      ]);
      expect(await checks()).toEqual([
        {
          yard: "pyp:okc",
          outcome: "unreported",
          reportedAt: first.getTime(),
          reportedRunId: "run-1",
          lastCheckedAt: null,
          lastCheckedRunId: null,
          lastChangedAt: first.getTime(),
          lastArrivalAt: first.getTime(),
          consecutiveUncheckedRuns: 1,
        },
        {
          yard: "pyp:tulsa",
          outcome: "fetched",
          reportedAt: first.getTime(),
          reportedRunId: "run-1",
          lastCheckedAt: first.getTime(),
          lastCheckedRunId: "run-1",
          lastChangedAt: first.getTime(),
          lastArrivalAt: first.getTime(),
          consecutiveUncheckedRuns: 0,
        },
      ]);

      // Tulsa is blocked and keeps its last check; OKC is fetched unchanged.
      await publish("run-2", second, [
        {
          source: "pyp",
          acceptance: "accepted",
          vehicles: cars,
          yardChecks: [
            { locationCode: "tulsa", outcome: "blocked" },
            { locationCode: "okc", outcome: "fetched" },
          ],
        },
      ]);
      expect(await checks()).toEqual([
        {
          yard: "pyp:okc",
          outcome: "fetched",
          reportedAt: second.getTime(),
          reportedRunId: "run-2",
          lastCheckedAt: second.getTime(),
          lastCheckedRunId: "run-2",
          lastChangedAt: first.getTime(),
          lastArrivalAt: first.getTime(),
          consecutiveUncheckedRuns: 0,
        },
        {
          yard: "pyp:tulsa",
          outcome: "blocked",
          reportedAt: second.getTime(),
          reportedRunId: "run-2",
          lastCheckedAt: first.getTime(),
          lastCheckedRunId: "run-1",
          lastChangedAt: first.getTime(),
          lastArrivalAt: first.getTime(),
          consecutiveUncheckedRuns: 1,
        },
      ]);

      // A changed car moves only its yard's change date; a new one its arrival.
      await publish("run-3", third, [
        {
          source: "pyp",
          acceptance: "accepted",
          vehicles: [
            car("A-1", "tulsa", "Red"),
            car("A-2", "tulsa"),
            car("B-1", "okc"),
          ],
          yardChecks: [
            { locationCode: "tulsa", outcome: "replayed" },
            { locationCode: "okc", outcome: "fetched" },
          ],
        },
      ]);
      expect(
        (await checks()).map((check) => ({
          yard: check.yard,
          outcome: check.outcome,
          lastCheckedAt: check.lastCheckedAt,
          lastChangedAt: check.lastChangedAt,
          lastArrivalAt: check.lastArrivalAt,
          consecutiveUncheckedRuns: check.consecutiveUncheckedRuns,
        })),
      ).toEqual([
        {
          yard: "pyp:okc",
          outcome: "fetched",
          lastCheckedAt: third.getTime(),
          lastChangedAt: first.getTime(),
          lastArrivalAt: first.getTime(),
          consecutiveUncheckedRuns: 0,
        },
        {
          yard: "pyp:tulsa",
          outcome: "replayed",
          lastCheckedAt: first.getTime(),
          lastChangedAt: third.getTime(),
          lastArrivalAt: first.getTime(),
          consecutiveUncheckedRuns: 2,
        },
      ]);
    } finally {
      client.close();
    }
  });

  test("a car that stays missing changes its yard only on the run that first misses it", async () => {
    const { client, publish, checks } = await harness();
    try {
      const fetched: YardCheckReport[] = [
        { locationCode: "tulsa", outcome: "fetched" },
      ];
      const keep = car("A-1", "tulsa");
      const pyp = (vehicles: CanonicalVehicle[]): SourceRun[] => [
        {
          source: "pyp",
          acceptance: "accepted",
          vehicles,
          yardChecks: fetched,
        },
      ];
      await publish("run-1", first, pyp([keep, car("A-2", "tulsa")]));
      await publish("run-2", second, pyp([keep]));
      await publish("run-3", third, pyp([keep]));
      expect((await checks()).map((check) => check.lastChangedAt)).toEqual([
        second.getTime(),
      ]);
    } finally {
      client.close();
    }
  });

  test("a rejected source's reports write nothing", async () => {
    const { client, publish, checks } = await harness();
    try {
      await publish("run-1", first, [
        {
          source: "pyp",
          acceptance: "accepted",
          vehicles: [car("A-1", "tulsa")],
          yardChecks: [{ locationCode: "tulsa", outcome: "fetched" }],
        },
        {
          source: "row52",
          acceptance: "rejected",
          vehicles: [{ ...car("R-1", "yard-9"), source: "row52" }],
          yardChecks: [{ locationCode: "yard-9", outcome: "fetched" }],
        },
      ]);
      expect((await checks()).map((check) => check.yard)).toEqual([
        "pyp:tulsa",
      ]);
    } finally {
      client.close();
    }
  });
});
