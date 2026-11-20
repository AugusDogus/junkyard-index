import { expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import {
  ingestionValidation,
  isValidationRejection,
  validationRejection,
} from "./ingestion-validation";
import { AutorecyclerProviderError } from "./errors";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import {
  createTestClient,
  TEST_SCHEMA,
  makeVehicle,
} from "./durable-ingestion-test-fixtures";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { validateDurableSourceRuns } from "./durable-source-validation";
import { terminalCursorWire } from "./durable-source-terminal-test-fixtures";

for (const guard of [
  "rejection ratio",
  "inventory floor",
  "previous-count drift",
  "duplicate ratio",
  "closing census mismatch",
]) {
  test(`${guard} remains a deterministic rejection through provider and Effect wrappers`, async () => {
    const failure = await Effect.runPromise(
      ingestionValidation({
        try: () => {
          throw new Error(guard);
        },
        catch: (cause) => new AutorecyclerProviderError({ from: 0, cause }),
      }),
    ).catch((error: unknown) => error);
    expect(isValidationRejection(failure)).toBe(true);
    expect(isValidationRejection(new Error("outer", { cause: failure }))).toBe(
      true,
    );
  });
}
test("HTTP/body and Redis errors remain transient even when their text mentions validation", async () => {
  const failure = await Effect.runPromise(
    Effect.fail(new Error("request/body closing validation HTTP 503")),
  ).catch((error: unknown) => error);
  expect(isValidationRejection(failure)).toBe(false);
  const error = { tag: "ProviderError", message: "closing drift" };
  expect(validationRejection(error)).toBe(error);
  expect(isValidationRejection(error)).toBe(true);
});

test.each([false, true])(
  "validation records distinguish transient failures from deterministic rejection (%s)",
  async (deterministic) => {
    const { client, cleanup } = createTestClient();
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const database = drizzle(client),
        snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        database,
        client,
        snapshotStore,
      );
      const now = new Date();
      const plan = await repository.prepareWakeup(now, ["pyp"]);
      if (plan.status !== "active" || !plan.runs[0])
        throw new Error("Expected run");
      const runId = plan.runs[0].runId;
      await repository.markSourceFailed({
        runId,
        source: "pyp",
        message: deterministic ? "closing drift" : "HTTP 503",
        validationRejected: deterministic,
      });
      await validateDurableSourceRuns({
        runId,
        database,
        batchClient: client,
        snapshotStore,
      });
      await client.execute({
        sql: "update ingestion_run set active_slot = null, status = 'success', stage = 'released', completed_at = ? where id = ?",
        args: [now.getTime(), runId],
      });
      const next = await repository.prepareWakeup(now, ["pyp"]);
      expect(next.status).toBe(deterministic ? "complete" : "waiting");
    } finally {
      cleanup();
    }
  },
);

test("HTTP response guards remain transient rather than suppressing the day's retries", async () => {
  const { fetchProviderResponse } = await import("./provider-http-client");
  const mock = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("temporarily unavailable", { status: 503 }),
  );
  try {
    const failure = await Effect.runPromise(
      fetchProviderResponse({
        url: "https://offline.example/",
        context: "offline",
        retry: { retryLimit: 0 },
        onResponse: (response) => {
          if (response.status !== 200)
            throw new Error("Expected complete HTTP 200");
        },
      }),
    ).catch((error: unknown) => error);
    expect(isValidationRejection(failure)).toBe(false);
  } finally {
    mock.mockRestore();
  }
});

for (const guard of [
  "floor",
  "rejection",
  "duplicates",
  "drift",
  "closing",
] as const) {
  test(`a completed crawl rejected by the ${guard} guard is not recrawled that day`, async () => {
    const { client, cleanup } = createTestClient();
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const database = drizzle(client),
        store = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        database,
        client,
        store,
      );
      const now = new Date("2026-11-17T10:00:00Z");
      const plan = await repository.prepareWakeup(now, ["pyp"]);
      if (plan.status !== "active" || !plan.runs[0])
        throw new Error("Expected scheduled source");
      const runId = plan.runs[0].runId;
      const unique = guard === "floor" ? 4999 : 5000;
      const rejected = guard === "rejection" ? 600 : 0;
      const duplicates = guard === "duplicates" ? 1700 : 0;
      const path = await store.put({
        runId,
        source: "pyp",
        chunk: {
          vehicles: Array.from({ length: unique }, (_, index) =>
            makeVehicle(`VIN-${index}`),
          ),
          observedVins: [],
        },
      });
      await client.execute({
        sql: "update ingestion_source_run set status = 'success', next_cursor = ?, snapshot_chunks = ?, vehicles_processed = ?, rejected_vehicles = ?, duplicate_vehicles = ?, errors = ? where run_id = ?",
        args: [
          terminalCursorWire("pyp"),
          JSON.stringify([path]),
          unique + rejected + duplicates,
          rejected,
          duplicates,
          guard === "closing" ? '["closing mismatch exceeds tolerance"]' : null,
          runId,
        ],
      });
      if (guard === "drift") {
        await client.execute(
          "insert into ingestion_run (id, source, status, stage, started_at, last_progress_at, inventory_published_at, search_published_at) values ('prior', 'pyp', 'success', 'released', 1, 1, 1, 1)",
        );
        await client.execute(
          "insert into ingestion_source_run (id, run_id, source, status, acceptance_status, unique_vehicles, started_at) values ('prior:pyp', 'prior', 'pyp', 'success', 'accepted', 20000, 1)",
        );
      }
      const validation = await validateDurableSourceRuns({
        runId,
        database,
        batchClient: client,
        snapshotStore: store,
      });
      expect(validation).toMatchObject({
        status: "ready",
        acceptedSources: [],
        rejectedSources: [{ source: "pyp" }],
      });
      const persisted = (
        await client.execute({
          sql: "select validation_errors from ingestion_source_run where run_id = ?",
          args: [runId],
        })
      ).rows[0]?.validation_errors;
      expect(typeof persisted).toBe("string");
      const messages = {
        floor: "minimum",
        rejection: "rejection ratio",
        duplicates: "duplicate ratio",
        drift: "drift limit",
        closing: "closing mismatch",
      };
      expect(String(persisted)).toContain(messages[guard]);
      await client.execute({
        sql: "update ingestion_run set active_slot = null, status = 'success', stage = 'released', completed_at = ? where id = ?",
        args: [now.getTime(), runId],
      });
      expect(
        (
          await repository.prepareWakeup(new Date("2026-11-17T15:00:00Z"), [
            "pyp",
          ])
        ).status,
      ).toBe("complete");
    } finally {
      cleanup();
    }
  });
}

// The drift guard compares against the source's newest accepted inventory
// publication, even one search never published (skipped search publication),
// never an older search-published run.
test.each([
  { newest: 20000, olderSearched: 5000, outcome: "rejected" },
  { newest: 5000, olderSearched: 20000, outcome: "accepted" },
] as const)(
  "drift compares 5,000 vehicles with the newest inventory publication ($newest), not an older search publication ($olderSearched)",
  async ({ newest, olderSearched, outcome }) => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const store = IngestionSnapshotStore.memory();
      for (const [id, unique, inventory, search] of [
        ["older-searched", olderSearched, 1, 1],
        ["newest-search-skipped", newest, 2, null],
      ] as const) {
        await client.execute({
          sql: "insert into ingestion_run (id, source, status, stage, started_at, last_progress_at, inventory_published_at, search_published_at) values (?, 'pyp', 'success', 'released', 1, 1, ?, ?)",
          args: [id, inventory, search],
        });
        await client.execute({
          sql: "insert into ingestion_source_run (id, run_id, source, status, acceptance_status, unique_vehicles, started_at) values (?, ?, 'pyp', 'success', 'accepted', ?, 1)",
          args: [`${id}:pyp`, id, unique],
        });
      }
      const path = await store.put({
        runId: "current",
        source: "pyp",
        chunk: {
          vehicles: Array.from({ length: 5000 }, (_, index) =>
            makeVehicle(`VIN-${index}`),
          ),
          observedVins: [],
        },
      });
      await client.execute({
        sql: "insert into ingestion_run (id, source, status, stage, active_slot, started_at, last_progress_at) values ('current', 'pyp', 'running', 'sources', 1, 2, 2)",
      });
      await client.execute({
        sql: "insert into ingestion_source_run (id, run_id, source, status, next_cursor, snapshot_chunks, vehicles_processed, started_at) values ('current:pyp', 'current', 'pyp', 'success', ?, ?, 5000, 2)",
        args: [terminalCursorWire("pyp"), JSON.stringify([path])],
      });

      const validation = await validateDurableSourceRuns({
        runId: "current",
        database: drizzle(client),
        batchClient: client,
        snapshotStore: store,
      });

      expect(validation).toMatchObject(
        outcome === "accepted"
          ? { status: "ready", acceptedSources: ["pyp"], rejectedSources: [] }
          : {
              status: "ready",
              acceptedSources: [],
              rejectedSources: [
                {
                  source: "pyp",
                  errors: expect.arrayContaining([
                    expect.stringContaining("drift limit"),
                  ]),
                },
              ],
            },
      );
    } finally {
      client.close();
    }
  },
);
