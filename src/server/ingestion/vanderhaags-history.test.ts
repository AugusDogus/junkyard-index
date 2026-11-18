import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { loadVanderHaagsPublishedCursor } from "./vanderhaags-history";
import {
  createTestClient,
  TEST_SCHEMA,
} from "./durable-ingestion-test-fixtures";

test("Vander Haags carry history comes only from accepted, successful, search-published inventory", async () => {
  const { client } = createTestClient();
  const database = drizzle(client);
  try {
    await client.executeMultiple(TEST_SCHEMA);
    expect(await loadVanderHaagsPublishedCursor(database)).toBeNull();
    for (const [id, published, status, acceptance] of [
      ["accepted", 100, "success", "accepted"],
      ["unpublished", null, "success", "accepted"],
      ["failed", 300, "error", "accepted"],
      ["rejected", 400, "success", "rejected"],
    ] as const) {
      await client.execute({
        sql: "insert into ingestion_run (id, source, status, started_at, last_progress_at, search_published_at) values (?, 'vanderhaags', 'success', 1, 1, ?)",
        args: [id, published],
      });
      await client.execute({
        sql: "insert into ingestion_source_run (id, run_id, source, status, acceptance_status, next_cursor, started_at) values (?, ?, 'vanderhaags', ?, ?, ?, 1)",
        args: [
          id,
          id,
          status,
          acceptance,
          JSON.stringify({ phase: "complete", marker: id }),
        ],
      });
    }
    expect(await loadVanderHaagsPublishedCursor(database)).toEqual({
      source: "vanderhaags",
      phase: "complete",
      marker: "accepted",
    });
    // Invalid historical state reaches the connector's explicit cold fallback.
    await client.execute(
      "update ingestion_source_run set next_cursor = 'corrupt' where id = 'accepted'",
    );
    expect(await loadVanderHaagsPublishedCursor(database)).toBe("corrupt");
  } finally {
    client.close();
  }
});
