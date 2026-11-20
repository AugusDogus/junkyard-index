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

test("only the newest accepted, search-published run seeds a census", async () => {
  const { client } = createTestClient();
  const database = drizzle(client);
  try {
    await client.executeMultiple(TEST_SCHEMA);
    expect(await loadPublishedSourceCursor(database, "aplus")).toBeNull();
    // Start order deliberately disagrees with publication order.
    for (const [id, source, published, status, acceptance, day, started] of [
      ["older", "aplus", 50, "success", "accepted", 50, 9],
      ["accepted", "aplus", 100, "success", "accepted", 100, 1],
      ["unpublished", "aplus", null, "success", "accepted", 200, 20],
      ["failed", "aplus", 300, "error", "rejected", 300, 2],
      ["partial", "aplus", 350, "partial", "accepted", 350, 3],
      ["rejected", "aplus", 400, "success", "rejected", 400, 4],
      ["other-source", "aviation", 500, "success", "accepted", 500, 5],
      ["chaz-unpublished", "chaz", null, "success", "accepted", 600, 6],
    ] as const) {
      await client.execute({
        sql: "insert into ingestion_run (id, source, status, started_at, last_progress_at, search_published_at) values (?, ?, 'success', ?, 1, ?)",
        args: [id, source, started, published],
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
      terminal(100),
    );
    // An accepted run that was never search-published seeds nothing.
    expect(await loadPublishedSourceCursor(database, "chaz")).toBeNull();
    // A cursor the codec rejects is handed back raw for a warned cold census.
    await client.execute(
      "update ingestion_source_run set next_cursor = '{\"source\":\"aplus\"}' where id = 'accepted'",
    );
    expect(await loadPublishedSourceCursor(database, "aplus")).toEqual({
      source: "aplus",
    });
    await client.execute(
      "update ingestion_source_run set next_cursor = 'corrupt' where id = 'accepted'",
    );
    expect(await loadPublishedSourceCursor(database, "aplus")).toBe("corrupt");
  } finally {
    client.close();
  }
});
