import { describe, expect, spyOn, test } from "bun:test";
import {
  executeDurableIngestion,
  ingestDurableSource,
  type DurableIngestionOperations,
} from "./durable-ingestion-orchestrator";
import type { DurableIngestionResult } from "./durable-ingestion-types";
import {
  DURABLE_INGESTION_SOURCES,
  type DurableIngestionSource,
  type DurableSourceCursor,
} from "./durable-source";

function pypCursorFromBoundary(): DurableSourceCursor {
  return { source: "pyp", page: 1 };
}

const COMPLETED_INGESTION: DurableIngestionResult = {
  runId: "run-1",
  totalUpserted: 1,
  totalDeleted: 0,
  counts: {
    row52: 0,
    pyp: 1,
    autorecycler: 0,
    pullapart: 0,
    upullitne: 0,
    upullitdavie: 0,
    gopullit: 0,
  },
  errors: [],
  durationMs: 10,
};

function makeOperations(
  overrides: Partial<DurableIngestionOperations> = {},
): DurableIngestionOperations {
  return {
    cleanupStale: async () => undefined,
    initialize: async (runId) => ({ status: "started", runId }),
    runChunk: async (_runId, cursor) => ({
      cursor,
      status: "complete",
      count: 0,
      pagesProcessed: 0,
      errors: [],
    }),
    markFailed: async () => {
      throw new Error("markFailed should not be called");
    },
    validateSources: async () => ({
      status: "ready",
      acceptedSources: [],
      rejectedSources: [],
    }),
    reconcile: async () => ({
      status: "complete",
      result: COMPLETED_INGESTION,
    }),
    markRunFailed: async () => undefined,
    ...overrides,
  };
}

describe("durable ingestion source orchestration", () => {
  test("advances typed checkpoints until the source is complete", async () => {
    const pages: number[] = [];
    const result = await ingestDurableSource({
      runId: "run-1",
      initialCursor: { source: "pyp", page: 1 },
      operations: {
        runChunk: async (_runId, cursor) => {
          if (cursor.source !== "pyp") throw new Error("Expected PYP cursor");
          pages.push(cursor.page);
          const complete = cursor.page !== 1;
          return {
            cursor: { source: "pyp", page: complete ? 21 : 11 },
            status: complete ? "complete" : "paused",
            count: complete ? 20 : 10,
            pagesProcessed: complete ? 20 : 10,
            errors: [],
          };
        },
        markFailed: async () => {
          throw new Error("markFailed should not be called");
        },
      },
    });

    expect(pages).toEqual([1, 11]);
    expect(result.status).toBe("complete");
    expect(result.cursor).toEqual({ source: "pyp", page: 21 });
  });

  test("records a terminal source failure with a valid source cursor", async () => {
    const result = await ingestDurableSource({
      runId: "run-1",
      initialCursor: {
        source: "row52",
        afterLocationId: 0,
        locationIds: [],
        skip: 0,
      },
      operations: {
        runChunk: async () => {
          throw new Error("provider unavailable");
        },
        markFailed: async (_runId, source, message) => ({
          cursor: {
            source: "row52",
            afterLocationId: 0,
            locationIds: [],
            skip: 0,
          },
          status: "failed",
          count: 0,
          pagesProcessed: 0,
          errors: [message],
        }),
      },
    });

    expect(result.errors).toEqual([
      "row52 ingestion failed: provider unavailable",
    ]);
  });

  test("rejects a cursor returned for a different source", async () => {
    const failures: string[] = [];
    await ingestDurableSource({
      runId: "run-1",
      initialCursor: pypCursorFromBoundary(),
      operations: {
        runChunk: async () => ({
          cursor: {
            source: "row52",
            afterLocationId: 0,
            locationIds: [],
            skip: 0,
          },
          status: "paused",
          count: 0,
          pagesProcessed: 0,
          errors: [],
        }),
        markFailed: async (_runId, source, message) => {
          failures.push(message);
          return {
            cursor: { source: "pyp", page: 1 },
            status: "failed",
            count: 0,
            pagesProcessed: 0,
            errors: [message],
          };
        },
      },
    });

    expect(failures).toEqual([
      "pyp ingestion failed: Source pyp returned a row52 cursor",
    ]);
  });
});

describe("durable ingestion lifecycle", () => {
  test("runs every coordinator phase in order", async () => {
    const events: string[] = [];
    const result = await executeDurableIngestion({
      runId: "run-1",
      operations: makeOperations({
        cleanupStale: async () => {
          events.push("cleanup-stale");
        },
        initialize: async (runId) => {
          events.push("initialize");
          return { status: "started", runId };
        },
        runChunk: async (_runId, cursor) => {
          events.push(`source:${cursor.source}`);
          return {
            cursor,
            status: "complete",
            count: 0,
            pagesProcessed: 0,
            errors: [],
          };
        },
        reconcile: async () => {
          events.push("reconcile");
          return { status: "complete", result: COMPLETED_INGESTION };
        },
      }),
    });

    expect(result).toEqual({
      status: "completed",
      ingestion: COMPLETED_INGESTION,
    });
    expect(events.slice(0, 2)).toEqual(["cleanup-stale", "initialize"]);
    const sourcePhaseEnd = 2 + DURABLE_INGESTION_SOURCES.length;
    expect(events.slice(2, sourcePhaseEnd)).toEqual(
      DURABLE_INGESTION_SOURCES.map((source) => `source:${source}`),
    );
    expect(events.slice(sourcePhaseEnd)).toEqual(["reconcile"]);
  });

  test("processes sources sequentially in priority order", async () => {
    let activeSources = 0;
    let maxActiveSources = 0;
    const sourceOrder: DurableIngestionSource[] = [];

    await executeDurableIngestion({
      runId: "run-1",
      operations: makeOperations({
        runChunk: async (_runId, cursor) => {
          sourceOrder.push(cursor.source);
          activeSources += 1;
          maxActiveSources = Math.max(maxActiveSources, activeSources);
          await Promise.resolve();
          activeSources -= 1;

          return {
            cursor,
            status: "complete",
            count: 0,
            pagesProcessed: 0,
            errors: [],
          };
        },
      }),
    });

    expect(sourceOrder).toEqual([...DURABLE_INGESTION_SOURCES]);
    expect(maxActiveSources).toBe(1);
  });

  test("stops after a deduplicated initialization", async () => {
    const events: string[] = [];
    const result = await executeDurableIngestion({
      runId: "run-1",
      operations: makeOperations({
        cleanupStale: async () => {
          events.push("cleanup-stale");
        },
        initialize: async () => {
          events.push("initialize");
          return { status: "deduplicated", activeRunId: "run-0" };
        },
        runChunk: async () => {
          throw new Error("runChunk should not be called");
        },
      }),
    });

    expect(result).toEqual({ status: "deduplicated", activeRunId: "run-0" });
    expect(events).toEqual(["cleanup-stale", "initialize"]);
  });

  test("stops when abandonment fences source validation", async () => {
    let reconciled = false;
    const execution = await executeDurableIngestion({
      runId: "run-abandoned",
      operations: makeOperations({
        validateSources: async () => ({ status: "stopped" }),
        reconcile: async () => {
          reconciled = true;
          return { status: "complete", result: COMPLETED_INGESTION };
        },
      }),
    });

    expect(execution).toEqual({ status: "stopped" });
    expect(reconciled).toBe(false);
  });

  test("records a recoverable failure without cleaning snapshots", async () => {
    const failures: string[] = [];
    await expect(
      executeDurableIngestion({
        runId: "run-1",
        operations: makeOperations({
          reconcile: async () => {
            throw new Error("database unavailable");
          },
          markRunFailed: async (_runId, message) => {
            failures.push(message);
          },
        }),
      }),
    ).rejects.toThrow("database unavailable");
    expect(failures).toEqual([
      "Durable ingestion failed: database unavailable",
    ]);
  });

  test("leaves snapshot cleanup to the post-publication phase", async () => {
    const events: string[] = [];
    const warning = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = await executeDurableIngestion({
        runId: "run-1",
        operations: makeOperations({
          reconcile: async () => {
            events.push("reconcile");
            return { status: "complete", result: COMPLETED_INGESTION };
          },
        }),
      });
      expect(result).toEqual({
        status: "completed",
        ingestion: COMPLETED_INGESTION,
      });
      expect(events).toEqual(["reconcile"]);
    } finally {
      warning.mockRestore();
    }
  });
});
