import { describe, expect, spyOn, test } from "bun:test";
import { stringify } from "devalue";
import {
  commitDurableIngestion,
  executeDurableIngestion,
  ingestDurableSource,
  stageDurableIngestion,
  type DurableIngestionOperations,
} from "./durable-ingestion-orchestrator";
import type { DurableIngestionResult } from "./durable-ingestion-types";
import {
  DURABLE_INGESTION_SOURCES,
  DURABLE_INITIAL_SOURCE_CURSORS,
  getDurableSourceDefinition,
  type DurableCursorFor,
  type DurableSourceCursor,
} from "./durable-source";
import type {
  DurableWorkflowChunkDeferral,
  DurableWorkflowChunkResult,
} from "./durable-workflow-cursor";

function pypCursorFromBoundary(): DurableSourceCursor {
  return { source: "pyp", storeCodes: null, storeIndex: 0, page: 0 };
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
    pullnsave: 0,
    tearapart: 0,
    wrenchapart: 0,
    upullrparts: 0,
    ipullupull: 0,
    upullitwa: 0,
    partsgalore: 0,
    rtp: 0,
    nvpap: 0,
    pontiac: 0,
    aero: 0,
    vanderhaags: 0,
    chesterfield: 0,
    utpap: 0,
    tritown: 0,
    whitebradstreet: 0,
    midway: 0,
    rightway: 0,
    ddauto: 0,
    rivervalley: 0,
    fenix: 0,
    importapart: 0,
    army: 0,
    idipull: 0,
    bigd: 0,
    pullsavewa: 0,
    littleton: 0,
    michigantruck: 0,
    joliet: 0,
    alln1: 0,
    grandpajohns: 0,
    pickers: 0,
    pipes: 0,
    uwrench: 0,
    millerstown: 0,
    pickapartva: 0,
    mccauley: 0,
    rustyhook: 0,
    aviation: 0,
    chaz: 0,
    citymotors: 0,
    awap: 0,
    clearsalvage: 0,
    aplus: 0,
    central: 0,
    northwest: 0,
    coutu: 0,
    kodak: 0,
    six03: 0,
    rohner: 0,
    pratt: 0,
    cars4parts: 0,
    meeks: 0,
    brandywine: 0,
    rmmdtp: 0,
    calton: 0,
    bigtruckpage: 0,
    speedys: 0,
    sandw: 0,
    denton: 0,
    beavers: 0,
    indianriver: 0,
    harrys: 0,
    budget: 0,
    scotts: 0,
    oem: 0,
    dutchers: 0,
    alsauto: 0,
    chasencars: 0,
    weberbrothers: 0,
    hawaiiparts: 0,
    modernmuscle: 0,
    carsandparts: 0,
    spartan: 0,
    oemgarage: 0,
    hagerman: 0,
    kandr: 0,
    jimsimport: 0,
    lonestarimports: 0,
    cstruck: 59,
    heavytruckparts: 500,
    alshned: 0,
    hollanderstores: 0,
    allied: 0,
    urgiis: 0,
    byot: 0,
    vinplus: 0,
  },
  errors: [],
  durationMs: 10,
};

function makeOperations(
  overrides: Partial<DurableIngestionOperations> = {},
): DurableIngestionOperations {
  return {
    initialize: async (runId) => ({
      status: "started",
      runId,
      initialCursors: DURABLE_INITIAL_SOURCE_CURSORS,
    }),
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
      search: "pending",
    }),
    markRunFailed: async () => undefined,
    waitForPublicationMode: async () => undefined,
    ...overrides,
  };
}

describe("durable ingestion source orchestration", () => {
  test.each([
    {
      error: {
        name: "RetryableError",
        message:
          "Could not resolve an owned yard address for organization 1761169972557x110781710658965700",
        token: "must not be included",
      },
      message:
        "Could not resolve an owned yard address for organization 1761169972557x110781710658965700",
    },
    {
      error: {
        message: "Workflow step failed",
        cause: { message: "Provider unavailable" },
      },
      message: "Workflow step failed: Provider unavailable",
    },
    {
      error: { message: "  ", cause: { message: "Provider unavailable" } },
      message: "Provider unavailable",
    },
    {
      error: { message: 42, token: "must not be included" },
      message: "Unknown ingestion error",
    },
    { error: null, message: "Unknown ingestion error" },
    { error: "", message: "Unknown ingestion error" },
    { error: "Provider unavailable", message: "Provider unavailable" },
    {
      error: {
        message: "Provider unavailable",
        cause: { message: "Provider unavailable" },
      },
      message: "Provider unavailable",
    },
    {
      error: new Error("PYP page 2: Provider unavailable", {
        cause: new Error("Provider unavailable"),
      }),
      message: "PYP page 2: Provider unavailable",
    },
    {
      error: new Error("Workflow step failed", {
        cause: new Error("Provider unavailable"),
      }),
      message: "Workflow step failed: Provider unavailable",
    },
  ])(
    "preserves validated workflow failure messages: $message",
    async ({ error, message }) => {
      const result = await ingestDurableSource({
        runId: "diagnostic-repro",
        initialCursor: {
          source: "autorecycler",
          phase: "page",
          beforeId: null,
        },
        operations: {
          runChunk: async () => {
            throw error;
          },
          markFailed: async (_runId, source, failure) => ({
            cursor: { source, phase: "page", beforeId: null },
            status: "failed",
            count: 0,
            pagesProcessed: 0,
            errors: [failure],
          }),
        },
      });
      expect(result.errors).toEqual([
        `autorecycler ingestion failed: ${message}`,
      ]);
    },
  );

  test("handles cyclic causes without losing the available message", async () => {
    const error = { message: "Provider unavailable", cause: {} };
    error.cause = error;
    await expect(
      ingestDurableSource({
        runId: "diagnostic-repro",
        initialCursor: {
          source: "autorecycler",
          phase: "page",
          beforeId: null,
        },
        operations: {
          runChunk: async () => {
            throw error;
          },
          markFailed: async (_runId, _source, message) => {
            throw new Error(message);
          },
        },
      }),
    ).rejects.toThrow("autorecycler ingestion failed: Provider unavailable");
  });

  test("advances typed checkpoints until the source is complete", async () => {
    const pages: number[] = [];
    const storeCodes = Array.from({ length: 20 }, (_, index) =>
      String(1200 + index),
    );
    const result = await ingestDurableSource({
      runId: "run-1",
      initialCursor: { source: "pyp", storeCodes, storeIndex: 0, page: 1 },
      operations: {
        runChunk: async (_runId, cursor) => {
          if (cursor.source !== "pyp" || "snapshotCursor" in cursor)
            throw new Error("Expected inline PYP cursor");
          pages.push(cursor.page);
          const complete = cursor.page !== 1;
          return {
            cursor: {
              source: "pyp",
              storeCodes,
              storeIndex: 0,
              page: complete ? 21 : 11,
            },
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
    expect(result.cursor).toEqual({
      source: "pyp",
      storeCodes,
      storeIndex: 0,
      page: 21,
    });
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
        runChunk: async function (this: unknown) {
          expect(this).toBeUndefined();
          throw new Error("provider unavailable");
        },
        markFailed: async function (this: unknown, _runId, source, message) {
          expect(this).toBeUndefined();
          return {
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
          };
        },
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
            cursor: pypCursorFromBoundary(),
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
  test("records serialized run failures and rethrows the original error", async () => {
    const error = { name: "RetryableError", message: "database unavailable" };
    const failures: string[] = [];
    await expect(
      executeDurableIngestion({
        runId: "diagnostic-repro",
        operations: makeOperations({
          reconcile: async () => {
            throw error;
          },
          markRunFailed: async function (this: unknown, _runId, message) {
            expect(this).toBeUndefined();
            failures.push(message);
          },
        }),
      }),
    ).rejects.toBe(error);
    expect(failures).toEqual([
      "Durable ingestion failed: database unavailable",
    ]);
  });

  test("runs every coordinator phase in order without serializing sibling callbacks", async () => {
    const events: string[] = [];
    const result = await executeDurableIngestion({
      runId: "run-1",
      operations: makeOperations({
        initialize: async function (this: unknown, runId) {
          stringify({ args: [runId], thisVal: this });
          expect(this).toBeUndefined();
          events.push("initialize");
          return {
            status: "started",
            runId,
            initialCursors: DURABLE_INITIAL_SOURCE_CURSORS,
          };
        },
        runChunk: async function (this: unknown, _runId, cursor) {
          expect(this).toBeUndefined();
          events.push(`source:${cursor.source}`);
          return {
            cursor,
            status: "complete",
            count: 0,
            pagesProcessed: 0,
            errors: [],
          };
        },
        validateSources: async function (this: unknown) {
          expect(this).toBeUndefined();
          return { status: "ready", acceptedSources: [], rejectedSources: [] };
        },
        reconcile: async function (this: unknown) {
          expect(this).toBeUndefined();
          events.push("reconcile");
          return {
            status: "complete",
            result: COMPLETED_INGESTION,
            search: "pending",
          };
        },
      }),
    });

    expect(result).toEqual({
      status: "completed",
      ingestion: COMPLETED_INGESTION,
      search: "pending",
    });
    // Stale snapshot cleanup runs in the daily maintenance consumer, not here.
    expect(events.slice(0, 1)).toEqual(["initialize"]);
    const sourcePhaseEnd = 1 + DURABLE_INGESTION_SOURCES.length;
    expect(events.slice(1, sourcePhaseEnd).sort()).toEqual(
      DURABLE_INGESTION_SOURCES.map((source) => `source:${source}`).sort(),
    );
    expect(events.slice(sourcePhaseEnd)).toEqual(["reconcile"]);
  });

  test("stops after a deduplicated initialization", async () => {
    const events: string[] = [];
    const result = await executeDurableIngestion({
      runId: "run-1",
      operations: makeOperations({
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
    expect(events).toEqual(["initialize"]);
  });

  test("stops when abandonment fences source validation", async () => {
    let reconciled = false;
    const execution = await executeDurableIngestion({
      runId: "run-abandoned",
      operations: makeOperations({
        validateSources: async () => ({ status: "stopped" }),
        reconcile: async () => {
          reconciled = true;
          return {
            status: "complete",
            result: COMPLETED_INGESTION,
            search: "pending",
          };
        },
      }),
    });

    expect(execution).toEqual({ status: "stopped" });
    expect(reconciled).toBe(false);
  });

  test("ends a run with no accepted source at validation, without committing", async () => {
    let reconciled = false;
    const operations = makeOperations({
      validateSources: async () => ({
        status: "released",
        acceptedSources: [],
        rejectedSources: [{ source: "pyp", errors: ["HTTP 503"] }],
      }),
      reconcile: async () => {
        reconciled = true;
        return {
          status: "complete",
          result: COMPLETED_INGESTION,
          search: "pending",
        };
      },
    });

    expect(
      await stageDurableIngestion({ runId: "run-rejected", operations }),
    ).toEqual({ status: "released" });
    expect(
      await executeDurableIngestion({ runId: "run-rejected", operations }),
    ).toEqual({ status: "released" });
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
            return {
              status: "complete",
              result: COMPLETED_INGESTION,
              search: "pending",
            };
          },
        }),
      });
      expect(result).toEqual({
        status: "completed",
        ingestion: COMPLETED_INGESTION,
        search: "pending",
      });
      expect(events).toEqual(["reconcile"]);
    } finally {
      warning.mockRestore();
    }
  });
});

describe("durable ingestion run sources", () => {
  test("ingests only the sources the run was created with", async () => {
    const ingested: string[] = [];
    const result = await executeDurableIngestion({
      runId: "run-1",
      operations: makeOperations({
        initialize: async (runId) => ({
          status: "started",
          runId,
          initialCursors: DURABLE_INITIAL_SOURCE_CURSORS.filter(
            (cursor) => cursor.source === "row52" || cursor.source === "pyp",
          ),
        }),
        runChunk: async (_runId, cursor) => {
          ingested.push(cursor.source);
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

    expect(result.status).toBe("completed");
    expect(ingested.sort()).toEqual(["pyp", "row52"]);
  });
});

describe("durable ingestion failure recording", () => {
  test("records a failure while initializing the run", async () => {
    const failures: string[] = [];
    await expect(
      executeDurableIngestion({
        runId: "run-1",
        operations: makeOperations({
          initialize: async () => {
            throw new Error("Turso unavailable");
          },
          markRunFailed: async (_runId, message) => {
            failures.push(message);
          },
        }),
      }),
    ).rejects.toThrow("Turso unavailable");
    expect(failures).toEqual(["Durable ingestion failed: Turso unavailable"]);
  });
});

test("a persisted provider retry time sleeps before the first resumed chunk", async () => {
  const retryAt = Date.now() + 3_600_000;
  const cursor = {
    source: "autorecycler",
    phase: "ario-read",
    offset: 200,
    closing: false,
    statePath: "private-snapshot",
    retryAt,
    freshness: { asOf: Date.now(), legacy: {}, eligibleYards: [] },
  } as const;
  let release = () => {};
  let requests = 0;
  const waits: number[] = [];
  const pending = ingestDurableSource({
    runId: "resumed-provider",
    initialCursor: {
      ...cursor,
      freshness: { ...cursor.freshness, eligibleYards: [] },
    },
    operations: {
      sleepUntil: async function (this: unknown, time) {
        expect(this).toBeUndefined();
        waits.push(time);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      runChunk: async () => {
        requests++;
        return {
          cursor: { source: "autorecycler", phase: "complete" },
          status: "complete",
          count: 0,
          pagesProcessed: 0,
          errors: [],
        };
      },
      markFailed: async () => {
        throw new Error("Provider waiting must not fail the source");
      },
    },
  });
  await Promise.resolve();
  expect(waits).toEqual([retryAt]);
  expect(requests).toBe(0);
  release();
  expect((await pending).status).toBe("complete");
  expect(requests).toBe(1);
});

describe("chunks deferred by a deep shared host queue", () => {
  const initialCursor: DurableCursorFor<"row52"> = {
    source: "row52",
    afterLocationId: 0,
    locationIds: [],
    skip: 0,
  };
  const deferral: DurableWorkflowChunkDeferral<"row52"> = {
    status: "deferred",
    cursor: initialCursor,
    message: "row52: URG IIS shared host turn did not arrive.",
  };
  const paused: DurableWorkflowChunkResult<"row52"> = {
    cursor: { ...initialCursor, skip: 1 },
    status: "paused",
    count: 0,
    pagesProcessed: 1,
    errors: [],
  };

  test("retry the same cursor after a durable pause, then keep advancing", async () => {
    const outcomes = [deferral, deferral, paused, deferral];
    const cursors: number[] = [];
    const waits: number[] = [];
    const now = spyOn(Date, "now");
    let clock = 0;
    now.mockImplementation(() => clock);
    try {
      const result = await ingestDurableSource({
        runId: "run-1",
        initialCursor,
        operations: {
          sleepUntil: async (time) => {
            waits.push(time - clock);
            clock = time;
          },
          runChunk: async (_runId, cursor) => {
            if ("snapshotCursor" in cursor || cursor.source !== "row52")
              throw new Error("Expected an inline Row52 cursor");
            cursors.push(cursor.skip);
            return (
              outcomes.shift() ?? {
                ...paused,
                cursor: { ...initialCursor, skip: 2 },
                status: "complete",
              }
            );
          },
          markFailed: async () => {
            throw new Error("A deferral must not fail the source");
          },
        },
      });
      expect(result.status).toBe("complete");
    } finally {
      now.mockRestore();
    }
    expect(cursors).toEqual([0, 0, 0, 1, 1]);
    expect(waits).toEqual([300_000, 300_000, 300_000]);
  });

  test("wait out a provider's longer Retry-After, never past the no-progress limit", async () => {
    const outcomes: DurableWorkflowChunkDeferral<"row52">[] = [
      { ...deferral, retryAfterMs: 60_000 },
      { ...deferral, retryAfterMs: 20 * 60_000 },
      { ...deferral, retryAfterMs: 24 * 60 * 60_000 },
    ];
    const waits: number[] = [];
    const now = spyOn(Date, "now");
    let clock = 0;
    now.mockImplementation(() => clock);
    try {
      const result = await ingestDurableSource({
        runId: "run-1",
        initialCursor,
        operations: {
          sleepUntil: async (time) => {
            waits.push(time - clock);
            clock = time;
          },
          runChunk: async () =>
            outcomes.shift() ?? { ...paused, status: "complete" },
          markFailed: async () => {
            throw new Error("A deferral must not fail the source");
          },
        },
      });
      expect(result.status).toBe("complete");
    } finally {
      now.mockRestore();
    }
    expect(waits).toEqual([300_000, 1_200_000, 3 * 60 * 60_000]);
  });

  test("fail the source clearly once no chunk has advanced for three hours", async () => {
    const now = spyOn(Date, "now");
    let clock = 0;
    now.mockImplementation(() => clock);
    let chunks = 0;
    try {
      const result = await ingestDurableSource({
        runId: "run-1",
        initialCursor,
        operations: {
          sleepUntil: async (time) => {
            clock = time;
          },
          runChunk: async () => {
            chunks++;
            return deferral;
          },
          markFailed: async (_runId, _source, message) => ({
            cursor: initialCursor,
            status: "failed",
            count: 0,
            pagesProcessed: 0,
            errors: [message],
          }),
        },
      });
      expect(result.status).toBe("failed");
      expect(result.errors[0]).toContain(
        "row52 ingestion failed: row52: URG IIS shared host turn did not arrive.",
      );
      expect(result.errors[0]).toContain("No chunk advanced for 180 minutes");
      expect(result.errors[0]).toContain("Prior inventory is preserved");
      // The deferral's own message names the cause; a provider credit or
      // capacity refusal is not a shared host queue problem.
      expect(result.errors[0]).not.toContain("shared host queue");
    } finally {
      now.mockRestore();
    }
    expect(chunks).toBe(37);
  });

  test("give up on a Chaz origin outage after 45 minutes", async () => {
    const chazCursor = getDurableSourceDefinition("chaz").initialCursor;
    const now = spyOn(Date, "now");
    let clock = 0;
    now.mockImplementation(() => clock);
    let chunks = 0;
    try {
      const result = await ingestDurableSource({
        runId: "run-1",
        initialCursor: chazCursor,
        operations: {
          sleepUntil: async (time) => {
            clock = time;
          },
          runChunk: async () => {
            chunks++;
            return {
              status: "deferred",
              cursor: chazCursor,
              message:
                "chaz: Chaz is not ready to be read: https://www.chazsauto.com/parts/makes/ answered HTTP 503.",
            };
          },
          markFailed: async (_runId, _source, message) => ({
            cursor: chazCursor,
            status: "failed",
            count: 0,
            pagesProcessed: 0,
            errors: [message],
          }),
        },
      });
      expect(result.status).toBe("failed");
      expect(result.errors[0]).toContain("No chunk advanced for 45 minutes");
    } finally {
      now.mockRestore();
    }
    // The waiting run holds one of the URG group places, so it stops long
    // before the three-hour default; Nov 26 outages lasted under 5 minutes.
    expect(chunks).toBe(10);
  });

  test("give up on an iPull-uPull rate limit after 45 minutes", async () => {
    const cursor = getDurableSourceDefinition("ipullupull").initialCursor;
    const now = spyOn(Date, "now");
    let clock = 0;
    now.mockImplementation(() => clock);
    let chunks = 0;
    try {
      const result = await ingestDurableSource({
        runId: "run-1",
        initialCursor: cursor,
        operations: {
          sleepUntil: async (time) => {
            clock = time;
          },
          runChunk: async () => {
            chunks++;
            return {
              status: "deferred",
              cursor,
              message:
                "ipullupull: iPull-uPull is not ready to be read: iPull-uPull CSV export answered HTTP 429 without Retry-After.",
            };
          },
          markFailed: async (_runId, _source, message) => ({
            cursor,
            status: "failed",
            count: 0,
            pagesProcessed: 0,
            errors: [message],
          }),
        },
      });
      expect(result.status).toBe("failed");
      expect(result.errors[0]).toContain("No chunk advanced for 45 minutes");
    } finally {
      now.mockRestore();
    }
    // Each retry repeats the run's first few requests, so a rate limit that
    // outlasts ten five-minute back-offs waits for the next scheduled run.
    expect(chunks).toBe(10);
  });
});

describe("an unreadable publication mode", () => {
  test("waits and retries reconciliation without counting a run failure", async () => {
    const events: string[] = [];
    let unreadable = 3;
    const result = await commitDurableIngestion({
      runId: "run-1",
      operations: makeOperations({
        reconcile: async () => {
          events.push("reconcile");
          if (unreadable > 0) {
            unreadable -= 1;
            return { status: "mode_unavailable" };
          }
          return {
            status: "complete",
            result: COMPLETED_INGESTION,
            search: "skipped",
          };
        },
        waitForPublicationMode: async () => {
          events.push("wait");
        },
        markRunFailed: async () => {
          events.push("markRunFailed");
        },
      }),
    });
    expect(result).toMatchObject({ status: "completed", search: "skipped" });
    expect(events).toEqual([
      "reconcile",
      "wait",
      "reconcile",
      "wait",
      "reconcile",
      "wait",
      "reconcile",
    ]);
  });
});

describe("a chunk that needs shared hosts the run was not admitted with", () => {
  const lambert = {
    lanes: ["urg:66.42.115.19"],
    places: [{ group: "urg", capacity: 6 }],
  };
  const initialCursor: DurableCursorFor<"row52"> = {
    source: "row52",
    afterLocationId: 0,
    locationIds: [],
    skip: 0,
  };
  const handsBack: DurableWorkflowChunkResult<"row52"> = {
    cursor: { ...initialCursor, skip: 1 },
    status: "paused",
    count: 0,
    pagesProcessed: 1,
    errors: [],
    needsClaims: lambert,
  };

  test("ends the source's fetch for a run the pass admitted", async () => {
    let chunks = 0;
    const result = await ingestDurableSource({
      runId: "run-1",
      initialCursor,
      operations: {
        admittedClaims: { lanes: ["urg:higgins"], places: [] },
        runChunk: async () => {
          chunks++;
          return handsBack;
        },
        markFailed: async () => {
          throw new Error("Handing claims back is not a failure");
        },
      },
    });
    expect(chunks).toBe(1);
    expect(result).toEqual(handsBack);
  });

  test("keeps fetching in a run nothing admitted", async () => {
    let chunks = 0;
    const result = await ingestDurableSource({
      runId: "run-1",
      initialCursor,
      operations: {
        runChunk: async () =>
          ++chunks === 1 ? handsBack : { ...handsBack, status: "complete" },
        markFailed: async () => {
          throw new Error("markFailed should not be called");
        },
      },
    });
    expect(chunks).toBe(2);
    expect(result.status).toBe("complete");
  });

  test("yields the run before validation, naming the claims it needs", async () => {
    let validated = false;
    const staging = await stageDurableIngestion({
      runId: "run-1",
      operations: makeOperations({
        admittedClaims: { lanes: ["urg:higgins"], places: [] },
        initialize: async (runId) => ({
          status: "started",
          runId,
          initialCursors: [initialCursor],
        }),
        runChunk: async (_runId, cursor) => ({
          cursor,
          status: "paused",
          count: 0,
          pagesProcessed: 1,
          errors: [],
          needsClaims: lambert,
        }),
        validateSources: async () => {
          validated = true;
          return { status: "ready", acceptedSources: [], rejectedSources: [] };
        },
      }),
    });
    expect(staging).toEqual({ status: "yielded", claims: lambert });
    expect(validated).toBe(false);
  });
});
