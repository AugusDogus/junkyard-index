import type { InStatement } from "@libsql/client";

export function savedSearchAlertCheckpointStatement(params: {
  checkedAtMs: number;
  publicationSequence: number;
  searchId: string;
  searchMatchVersion: number;
  runId: string;
  expectedRunCursor: string | null;
  quarantineReason: string | null;
}): InStatement {
  return {
    sql: `
      update saved_search
      set last_checked_at = ?,
          last_matched_publication_sequence = ?,
          alert_quarantined_at = ?,
          alert_quarantine_reason = ?,
          updated_at = updated_at
      where id = ? and search_match_version = ?
        and exists (
          select 1 from ingestion_run
          where id = ? and status = 'running' and active_slot = 1
            and stage = 'match_alerts' and publication_sequence = ?
            and alert_match_cursor is ?
        )
    `,
    args: [
      params.checkedAtMs,
      params.publicationSequence,
      params.quarantineReason ? params.checkedAtMs : null,
      params.quarantineReason,
      params.searchId,
      params.searchMatchVersion,
      params.runId,
      params.publicationSequence,
      params.expectedRunCursor,
    ],
  };
}
