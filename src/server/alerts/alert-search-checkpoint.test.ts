import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { savedSearchAlertCheckpointStatement } from "./alert-search-checkpoint";

describe("saved search alert checkpoints", () => {
  test("persists quarantine state behind the active-run fence and clears it after recovery", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(`
        create table ingestion_run (
          id text primary key, status text not null, active_slot integer,
          stage text not null, publication_sequence integer,
          alert_match_cursor text
        );
        create table saved_search (
          id text primary key, search_match_version integer not null,
          last_checked_at integer, last_matched_publication_sequence integer,
          alert_quarantined_at integer, alert_quarantine_reason text,
          updated_at integer not null default 0
        );
        insert into ingestion_run values (
          'run-1', 'running', 1, 'match_alerts', 7, null
        );
        insert into saved_search (id, search_match_version)
        values ('search-1', 1);
      `);
      const checkpoint = (quarantineReason: string | null) =>
        client.execute(
          savedSearchAlertCheckpointStatement({
            checkedAtMs: 1_777_036_400_000,
            publicationSequence: 7,
            searchId: "search-1",
            searchMatchVersion: 1,
            runId: "run-1",
            expectedRunCursor: null,
            quarantineReason,
          }),
        );

      expect((await checkpoint("Narrow this saved search.")).rowsAffected).toBe(
        1,
      );
      let row = await client.execute(
        "select alert_quarantined_at, alert_quarantine_reason from saved_search",
      );
      expect(row.rows[0]?.alert_quarantined_at).toBe(1_777_036_400_000);
      expect(row.rows[0]?.alert_quarantine_reason).toBe(
        "Narrow this saved search.",
      );

      expect((await checkpoint(null)).rowsAffected).toBe(1);
      row = await client.execute(
        "select alert_quarantined_at, alert_quarantine_reason from saved_search",
      );
      expect(row.rows[0]?.alert_quarantined_at).toBeNull();
      expect(row.rows[0]?.alert_quarantine_reason).toBeNull();

      await client.execute(
        "update ingestion_run set status = 'abandoned', active_slot = null",
      );
      expect((await checkpoint("must not persist")).rowsAffected).toBe(0);
    } finally {
      client.close();
    }
  });
});
