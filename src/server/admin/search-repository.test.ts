import { describe, expect, test } from "bun:test";
import { createAdminTestDatabase } from "./admin-test-database";
import { BACKLOG_COUNT_CAP, SearchRepository } from "./search-repository";

async function addRun(
  client: Awaited<ReturnType<typeof createAdminTestDatabase>>["client"],
  id: string,
  searchPublishedAt: number | null,
  fullReindexRequired = 0,
) {
  await client.execute({
    sql: `insert into ingestion_run
      (id, source, status, started_at, last_progress_at, search_published_at,
       published_vehicle_count, inventory_outcome, full_reindex_required)
      values (?, 'pyp', 'success', 0, 0, ?, 100, 'published', ?)`,
    args: [id, searchPublishedAt, fullReindexRequired],
  });
}

describe("SearchRepository", () => {
  test("recentPublications reads the newest search publications", async () => {
    const { client, db } = await createAdminTestDatabase();
    await addRun(client, "unpublished", null);
    await addRun(client, "older", 1_000);
    await addRun(client, "newer", 2_000);
    await addRun(client, "newest", 3_000);
    const publications = await SearchRepository.recentPublications(db, 2);
    expect(publications).toEqual([
      {
        runId: "newest",
        source: "pyp",
        searchPublishedAt: new Date(3_000),
        inventoryPublishedAt: null,
        publishedVehicleCount: 100,
        inventoryOutcome: "published",
      },
      expect.objectContaining({ runId: "newer" }),
    ]);
  });

  test("unprocessedChanges counts waiting changes and finds the oldest", async () => {
    const { client, db } = await createAdminTestDatabase();
    expect(await SearchRepository.unprocessedChanges(db)).toEqual({
      count: 0,
      capped: false,
      oldestCreatedAt: null,
    });
    await client.execute(`insert into vehicle_change_v2
      (run_id, vin, change_type, created_at, processed_at) values
      ('r', 'A', 'upsert', 10, 99), ('r', 'B', 'upsert', 20, null),
      ('r', 'C', 'delete', 30, null)`);
    expect(await SearchRepository.unprocessedChanges(db)).toEqual({
      count: 2,
      capped: false,
      oldestCreatedAt: new Date(20),
    });
  });

  test("unprocessedChanges stops counting at the cap", async () => {
    const { client, db } = await createAdminTestDatabase();
    await client.execute(`
      with recursive n(i) as (select 1 union all select i + 1 from n where i < ${BACKLOG_COUNT_CAP + 5})
      insert into vehicle_change_v2 (run_id, vin, change_type, created_at)
      select 'r', 'VIN' || i, 'upsert', i from n
    `);
    expect(await SearchRepository.unprocessedChanges(db)).toMatchObject({
      count: BACKLOG_COUNT_CAP,
      capped: true,
    });
  });

  test("fullReindexRequired is true while any run owes a rebuild", async () => {
    const { client, db } = await createAdminTestDatabase();
    await addRun(client, "clean", 1_000);
    expect(await SearchRepository.fullReindexRequired(db)).toBe(false);
    await addRun(client, "owes", null, 1);
    expect(await SearchRepository.fullReindexRequired(db)).toBe(true);
  });
});
