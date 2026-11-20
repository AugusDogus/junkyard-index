import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import {
  AplusCursor,
  type AplusCursor as AplusCursorValue,
} from "./aplus-cursor";
import {
  createTestClient,
  TEST_SCHEMA,
} from "./durable-ingestion-test-fixtures";
import { loadPublishedSourceCursor } from "./published-source-cursor";

/** A terminal A Plus cursor whose census day identifies the run it came from. */
const terminal = (day: number): AplusCursorValue => ({
  source: "aplus",
  version: 1,
  phase: "complete",
  census: { contract: "fixture", day, models: [] },
});

test("only the newest accepted inventory publication seeds a census, even while search publication is skipped", async () => {
  const { client } = createTestClient();
  const database = drizzle(client);
  try {
    await client.executeMultiple(TEST_SCHEMA);
    expect(await loadPublishedSourceCursor(database, "aplus")).toBeNull();
    // Start order deliberately disagrees with publication order. `inventory`
    // is inventory_published_at, `search` is search_published_at.
    for (const [
      id,
      source,
      inventory,
      search,
      status,
      acceptance,
      day,
      started,
    ] of [
      ["older", "aplus", 50, 55, "success", "accepted", 50, 9],
      ["searched", "aplus", 100, 110, "success", "accepted", 100, 1],
      // Released while ingestion-skip-search-publication is on.
      ["search-skipped", "aplus", 150, null, "success", "accepted", 150, 2],
      ["unpublished", "aplus", null, null, "success", "accepted", 200, 20],
      ["failed", "aplus", 300, null, "error", "rejected", 300, 3],
      ["partial", "aplus", 350, null, "partial", "accepted", 350, 4],
      ["rejected", "aplus", 400, 410, "success", "rejected", 400, 5],
      ["other-source", "aviation", 500, 510, "success", "accepted", 500, 6],
      // Search publication alone never makes a run published.
      ["chaz-search-only", "chaz", null, 600, "success", "accepted", 600, 7],
    ] as const) {
      await client.execute({
        sql: "insert into ingestion_run (id, source, status, started_at, last_progress_at, inventory_published_at, search_published_at) values (?, ?, 'success', ?, 1, ?, ?)",
        args: [id, source, started, inventory, search],
      });
      await client.execute({
        sql: "insert into ingestion_source_run (id, run_id, source, status, acceptance_status, next_cursor, snapshot_chunks, started_at) values (?, ?, ?, ?, ?, ?, '[]', 1)",
        args: [
          id,
          id,
          source,
          status,
          acceptance,
          AplusCursor.serialize(terminal(day)),
        ],
      });
    }
    expect(await loadPublishedSourceCursor(database, "aplus")).toEqual(
      terminal(150),
    );
    expect(await loadPublishedSourceCursor(database, "chaz")).toBeNull();
    // A cursor the codec rejects is handed back raw for a warned cold census.
    await client.execute(
      "update ingestion_source_run set next_cursor = '{\"source\":\"aplus\"}' where id = 'search-skipped'",
    );
    expect(await loadPublishedSourceCursor(database, "aplus")).toEqual({
      source: "aplus",
    });
    await client.execute(
      "update ingestion_source_run set next_cursor = 'corrupt' where id = 'search-skipped'",
    );
    expect(await loadPublishedSourceCursor(database, "aplus")).toBe("corrupt");
  } finally {
    client.close();
  }
});
