import { describe, expect, test } from "bun:test";
import { createAdminTestDatabase } from "./admin-test-database";
import {
  ERROR_EXCERPT_CHARS,
  ERROR_TEXT_LIMIT_CHARS,
  SourceRunRepository,
} from "./source-run-repository";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-11-22T15:00:00Z");

async function database() {
  const { client, db } = await createAdminTestDatabase();
  const addRun = async (params: {
    id: string;
    source: string;
    startedAt: number;
    status?: string;
    activeSlot?: number | null;
    publishedAt?: number | null;
    errors?: string | null;
    runErrors?: string | null;
    acceptanceStatus?: string;
  }) => {
    await client.execute({
      sql: `insert into ingestion_run
        (id, source, status, stage, active_slot, started_at, last_progress_at, inventory_published_at, errors)
        values (?, ?, ?, 'released', ?, ?, ?, ?, ?)`,
      args: [
        params.id,
        params.source,
        params.status ?? "success",
        params.activeSlot ?? null,
        params.startedAt,
        params.startedAt,
        params.publishedAt ?? null,
        params.runErrors ?? null,
      ],
    });
    await client.execute({
      sql: `insert into ingestion_source_run
        (id, run_id, source, status, acceptance_status, unique_vehicles, errors, next_cursor, started_at, completed_at)
        values (?, ?, ?, ?, ?, 10, ?, 'cursor', ?, ?)`,
      args: [
        `${params.id}-source`,
        params.id,
        params.source,
        params.errors ? "error" : "success",
        params.acceptanceStatus ?? (params.errors ? "rejected" : "accepted"),
        params.errors ?? null,
        params.startedAt,
        params.startedAt + 1000,
      ],
    });
  };
  return { client, db, addRun };
}

describe("SourceRunRepository", () => {
  test("recent reads runs started inside the window only", async () => {
    const { db, addRun } = await database();
    await addRun({ id: "old", source: "pyp", startedAt: now - 20 * DAY });
    await addRun({
      id: "new",
      source: "pyp",
      startedAt: now - DAY,
      publishedAt: now - DAY + 5000,
    });
    const runs = await SourceRunRepository.recent(db, new Date(now - 14 * DAY));
    expect(runs).toEqual([
      expect.objectContaining({
        id: "new-source",
        runId: "new",
        source: "pyp",
        status: "success",
        acceptanceStatus: "accepted",
        runStatus: "success",
        stage: "released",
        startedAt: new Date(now - DAY),
        completedAt: new Date(now - DAY + 1000),
        inventoryPublishedAt: new Date(now - DAY + 5000),
        uniqueVehicles: 10,
      }),
    ]);
  });

  test("errorExcerpts cuts each run's error text", async () => {
    const { db, addRun } = await database();
    const long = JSON.stringify(["x".repeat(ERROR_EXCERPT_CHARS * 2)]);
    await addRun({ id: "a", source: "pyp", startedAt: now, errors: long });
    await addRun({ id: "b", source: "row52", startedAt: now });
    await addRun({ id: "c", source: "pyp", startedAt: now, errors: long });
    const excerpts = await SourceRunRepository.errorExcerpts(db, [
      { id: "a-source", source: "pyp", startedAt: new Date(now) },
      { id: "b-source", source: "row52", startedAt: new Date(now) },
    ]);
    expect(excerpts.get("a-source")?.errors).toBe(
      long.slice(0, ERROR_EXCERPT_CHARS),
    );
    expect(excerpts.get("b-source")).toEqual({
      errors: null,
      validationErrors: null,
      runErrors: null,
    });
    expect(excerpts.has("c-source")).toBe(false);
    expect(await SourceRunRepository.errorExcerpts(db, [])).toEqual(new Map());
  });

  test("errorExcerpts and forSource read an expired run's error from its ingestion run", async () => {
    const { db, addRun } = await database();
    const expired = JSON.stringify([
      "The staged snapshot expired after waiting more than 24 hours for the commit turn.",
    ]);
    await addRun({
      id: "expired",
      source: "pyp",
      startedAt: now,
      status: "error",
      acceptanceStatus: "expired",
      runErrors: expired,
    });
    expect(
      (
        await SourceRunRepository.errorExcerpts(db, [
          { id: "expired-source", source: "pyp", startedAt: new Date(now) },
        ])
      ).get("expired-source"),
    ).toEqual({ errors: null, validationErrors: null, runErrors: expired });
    const [run] = await SourceRunRepository.forSource(db, "pyp", 1);
    expect(run).toMatchObject({
      acceptanceStatus: "expired",
      runStatus: "error",
      runErrors: expired,
      errorsCutOff: false,
    });
  });

  test("forSource marks run errors over the limit as cut off", async () => {
    const { db, addRun } = await database();
    await addRun({
      id: "big",
      source: "pyp",
      startedAt: now,
      runErrors: JSON.stringify(["z".repeat(ERROR_TEXT_LIMIT_CHARS)]),
    });
    const [run] = await SourceRunRepository.forSource(db, "pyp", 1);
    expect(run?.errorsCutOff).toBe(true);
    expect(run?.runErrors?.length).toBe(ERROR_TEXT_LIMIT_CHARS);
  });

  test("recentForSource reads one source's runs inside the window only", async () => {
    const { db, addRun } = await database();
    await addRun({ id: "old", source: "pyp", startedAt: now - 20 * DAY });
    await addRun({ id: "new", source: "pyp", startedAt: now - DAY });
    await addRun({ id: "other", source: "row52", startedAt: now - DAY });
    const runs = await SourceRunRepository.recentForSource(
      db,
      "pyp",
      new Date(now - 14 * DAY),
    );
    expect(runs.map((run) => run.runId)).toEqual(["new"]);
  });

  test("forSource reads the source's newest runs, newest first, up to the limit", async () => {
    const { db, addRun } = await database();
    const huge = JSON.stringify(["y".repeat(ERROR_TEXT_LIMIT_CHARS)]);
    await addRun({ id: "1", source: "pyp", startedAt: now - 3 * DAY });
    await addRun({ id: "2", source: "pyp", startedAt: now - 2 * DAY });
    await addRun({
      id: "3",
      source: "pyp",
      startedAt: now - DAY,
      errors: huge,
    });
    await addRun({ id: "other", source: "row52", startedAt: now });
    const runs = await SourceRunRepository.forSource(db, "pyp", 2);
    expect(runs.map((run) => run.runId)).toEqual(["3", "2"]);
    expect(runs[0]?.errorsCutOff).toBe(true);
    expect(runs[0]?.errors?.length).toBe(ERROR_TEXT_LIMIT_CHARS);
    expect(runs[1]?.errorsCutOff).toBe(false);
  });

  test("activeRuns reads runs holding an active slot, with their commit turn", async () => {
    const { client, db, addRun } = await database();
    await addRun({ id: "done", source: "pyp", startedAt: now - DAY });
    await addRun({
      id: "live",
      source: "row52",
      startedAt: now,
      status: "running",
      activeSlot: 1,
    });
    await client.execute({
      sql: `update ingestion_run
        set workflow_run_id = 'wrun-live', commit_started_at = ?, ready_at = ?
        where id = 'live'`,
      args: [now + 2, now + 1],
    });
    expect(await SourceRunRepository.activeRuns(db)).toEqual([
      {
        runId: "live",
        source: "row52",
        stage: "released",
        workflowRunId: "wrun-live",
        startedAt: new Date(now),
        lastProgressAt: new Date(now),
        readyAt: new Date(now + 1),
        commitStartedAt: new Date(now + 2),
      },
    ]);
  });

  test("stopTarget reads one run's source, status and stage, or null", async () => {
    const { db, addRun } = await database();
    await addRun({
      id: "live",
      source: "row52",
      startedAt: now,
      status: "running",
      activeSlot: 1,
    });
    expect(await SourceRunRepository.stopTarget(db, "live")).toEqual({
      runId: "live",
      source: "row52",
      status: "running",
      stage: "released",
    });
    expect(await SourceRunRepository.stopTarget(db, "missing")).toBeNull();
  });

  test("publishedCounts sums each source's yards", async () => {
    const { client, db } = await database();
    for (const [source, code, count] of [
      ["pyp", "1", 5],
      ["pyp", "2", 7],
      ["row52", "1", 3],
    ] as const) {
      await client.execute({
        sql: `insert into yard_inventory
          (source, location_code, location_name, location_city, state_abbr, lat, lng, vehicle_count, updated_at)
          values (?, ?, 'Yard', 'City', 'CA', 0, 0, ?, 0)`,
        args: [source, code, count],
      });
    }
    expect(await SourceRunRepository.publishedCounts(db)).toEqual(
      new Map([
        ["pyp", 12],
        ["row52", 3],
      ]),
    );
  });
});
