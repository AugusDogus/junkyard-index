import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionSourceRun } from "~/schema";
import type { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { parseSnapshotChunks } from "./durable-ingestion-repository";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
  type DurableCursorFor,
  type DurableIngestionSource,
} from "./durable-source";
import type {
  DurableWorkflowCursor,
  DurableCursorReference,
} from "./durable-workflow-cursor";

export function createDurableWorkflowCursorStore(
  database: LibSQLDatabase,
  snapshotStore: IngestionSnapshotStore,
) {
  return {
    /** Keep every Workflow-visible cursor below 256 KiB, including sources
     * with large transient graphs. References use normal guarded snapshot
     * registration and cleanup, independently of provider checkpointState. */
    async compact<Source extends DurableIngestionSource>(
      runId: string,
      cursor: DurableCursorFor<Source>,
    ): Promise<DurableWorkflowCursor<Source>> {
      const wire = serializeDurableSourceCursor(cursor);
      if (Buffer.byteLength(wire) <= 256 * 1024) return cursor;
      const path = await snapshotStore.put({
        runId,
        source: cursor.source,
        chunk: { vehicles: [], observedVins: [], checkpointState: wire },
      });
      try {
        const updated = await database.run(sql`
          update ingestion_source_run
          set snapshot_chunks = json_insert(snapshot_chunks, '$[#]', ${path})
          where run_id = ${runId} and source = ${cursor.source} and next_cursor = ${wire}
            and exists (
              select 1 from ingestion_run
              where id = ${runId} and status = 'running' and active_slot = 1
            )
        `);
        if (updated.rowsAffected !== 1)
          throw new Error(
            `Cannot register Workflow cursor for ${runId}:${cursor.source}: checkpoint changed. Retry from its latest checkpoint; published inventory is preserved.`,
          );
      } catch (error) {
        await snapshotStore.delete([path], { kind: "best-effort" });
        throw error;
      }
      const reference: DurableCursorReference<Source> = {
        source: cursor.source,
        snapshotCursor: {
          path,
          checksum: createHash("sha256").update(wire).digest("hex"),
        },
      };
      if ("retryAt" in cursor && typeof cursor.retryAt === "number")
        reference.retryAt = cursor.retryAt;
      return reference;
    },

    async resolve<Source extends DurableIngestionSource>(
      runId: string,
      cursor: DurableWorkflowCursor<Source>,
    ): Promise<DurableCursorFor<Source>> {
      if (!("snapshotCursor" in cursor)) return cursor;
      const [row] = await database
        .select({ chunks: ingestionSourceRun.snapshotChunks })
        .from(ingestionSourceRun)
        .where(
          and(
            eq(ingestionSourceRun.runId, runId),
            eq(ingestionSourceRun.source, cursor.source),
          ),
        )
        .limit(1);
      if (
        !row ||
        !parseSnapshotChunks(row.chunks).includes(cursor.snapshotCursor.path)
      )
        throw new Error(
          `Workflow cursor for ${runId}:${cursor.source} references an unregistered snapshot. Resume the latest checkpoint; published inventory is preserved.`,
        );
      const wire = (await snapshotStore.load(cursor.snapshotCursor.path))
        .checkpointState;
      if (
        typeof wire !== "string" ||
        createHash("sha256").update(wire).digest("hex") !==
          cursor.snapshotCursor.checksum
      )
        throw new Error(
          `Workflow cursor snapshot for ${runId}:${cursor.source} failed its checksum. Inspect private Blob storage before restarting; published inventory is preserved.`,
        );
      return parseDurableSourceCursor(cursor.source, wire);
    },
  };
}
