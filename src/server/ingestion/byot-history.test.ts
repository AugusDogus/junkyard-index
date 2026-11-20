import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { loadByotPublishedCursor } from "./byot-history";
import { ByotCursor } from "./byot-cursor";
import { byotTerminal, byotValue } from "./byot-test-fixtures";

test("weekly sweep resumes only from the latest accepted inventory-published terminal cursor", async () => {
  const client = createClient({ url: ":memory:" });
  const database = drizzle(client);
  try {
    await client.execute(
      "create table ingestion_run (id text primary key, inventory_published_at integer)",
    );
    await client.execute(
      "create table ingestion_source_run (run_id text, source text, status text, acceptance_status text, next_cursor text)",
    );
    expect(await loadByotPublishedCursor(database)).toBeNull();
    const previous = byotTerminal(0);
    const wire = byotValue(ByotCursor.serialize(previous));
    for (const [id, published, status, acceptance, cursor] of [
      ["accepted", 100, "success", "accepted", wire],
      ["unpublished", null, "success", "accepted", "bad"],
      ["failed", 300, "error", "rejected", "bad"],
      ["rejected", 400, "success", "rejected", "bad"],
    ] as const) {
      await client.execute({
        sql: "insert into ingestion_run values (?, ?)",
        args: [id, published],
      });
      await client.execute({
        sql: "insert into ingestion_source_run values (?, 'byot', ?, ?, ?)",
        args: [id, status, acceptance, cursor],
      });
    }
    expect(await loadByotPublishedCursor(database)).toEqual(previous);
    await client.execute({
      sql: "update ingestion_source_run set next_cursor = ? where run_id = 'accepted'",
      args: [byotValue(ByotCursor.serialize(ByotCursor.initial()))],
    });
    await expect(loadByotPublishedCursor(database)).rejects.toThrow(
      "not terminal",
    );
    await client.execute(
      "update ingestion_source_run set next_cursor = null where run_id = 'accepted'",
    );
    await expect(loadByotPublishedCursor(database)).rejects.toThrow(
      "no terminal cursor",
    );
  } finally {
    client.close();
  }
});
