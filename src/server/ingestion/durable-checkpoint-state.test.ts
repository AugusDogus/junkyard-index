import { expect, spyOn, test } from "bun:test";
import { BlobServiceRateLimited } from "@vercel/blob";
import { isDeepStrictEqual } from "node:util";
import { drizzle } from "drizzle-orm/libsql";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import type { FetchedDurableSourceChunk } from "./durable-ingestion-types";
import {
  createTestClient,
  makeVehicle,
  stagedSnapshots,
  TEST_SCHEMA,
} from "./durable-ingestion-test-fixtures";
import { HollanderstoresDurableCursor } from "./hollanderstores-durable-cursor";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { parseSnapshotChunks } from "./ingestion-snapshot-cleanup";
import { loadRunSnapshotInventory } from "./run-snapshot-inventory";

const RUN_ID = "hollander-run";
const SOURCE_RUN_ID = `${RUN_ID}:hollanderstores`;

type HollanderCursor = HollanderstoresDurableCursor;

function decoding(requests: number): HollanderCursor {
  return {
    ...HollanderstoresDurableCursor.initial(),
    phase: "decoding",
    requests,
    checksum: requests.toString(16).padStart(8, "0"),
    statePath: null,
  };
}

/** A Hollander chunk whose census checkpoint is a large provider state. */
function hollanderChunk(
  requests: number,
  vins: readonly string[],
): FetchedDurableSourceChunk<"hollanderstores"> {
  return {
    cursor: decoding(requests),
    status: "paused",
    pagesProcessed: 1,
    vehiclesProcessed: vins.length,
    uniqueVehicles: vins.length,
    duplicateVehicles: 0,
    rejectedVehicles: 0,
    errors: [],
    vehicles: vins.map((vin) => ({
      ...makeVehicle(vin),
      source: "hollanderstores" as const,
    })),
    yards: [],
    checkpointState: { census: `census after request ${requests}` },
  };
}

async function setup() {
  const database = createTestClient();
  await database.client.executeMultiple(TEST_SCHEMA);
  const store = IngestionSnapshotStore.memory();
  const repository = createDurableIngestionRepository(
    drizzle(database.client),
    database.client,
    store,
  );
  await repository.initialize(RUN_ID, async () => ["hollanderstores"]);
  const registered = async () =>
    parseSnapshotChunks(
      String(
        (
          await database.client.execute({
            sql: "select snapshot_chunks from ingestion_source_run where id = ?",
            args: [SOURCE_RUN_ID],
          })
        ).rows[0]?.snapshot_chunks,
      ),
    );
  return { database, store, repository, registered };
}

function statePathOf(cursor: HollanderCursor): string {
  if (cursor.phase === "initial" || cursor.statePath === null)
    throw new Error("Checkpoint has no state path");
  return cursor.statePath;
}

const isState = (path: string) =>
  IngestionSnapshotStore.isCheckpointStatePath(path);

test("a source run keeps one checkpoint state, outside every vehicle chunk", async () => {
  const { database, store, repository, registered } = await setup();
  try {
    let cursor: HollanderCursor = HollanderstoresDurableCursor.initial();
    for (const [requests, vin] of [
      [1, "1FAHP2J89EG117591"],
      [2, "1FAHP2J89EG117592"],
      [3, "1FAHP2J89EG117593"],
    ] as const) {
      const saved = await repository.checkpointChunk({
        runId: RUN_ID,
        requestedCursor: cursor,
        fetched: hollanderChunk(requests, [vin]),
      });
      cursor = saved.cursor;
    }

    const chunks = (await registered()).filter((path) => !isState(path));
    expect(chunks).toHaveLength(3);
    for (const path of chunks)
      expect((await store.load(path)).checkpointState).toBeUndefined();
    // Latest wins: only the state the cursor resumes from is still stored,
    // and every registered blob exists.
    const statePath = statePathOf(cursor);
    expect(store.pathnames().filter(isState)).toEqual([statePath]);
    expect(await registered()).toEqual([...chunks, statePath]);
    expect(store.pathnames().sort()).toEqual((await registered()).sort());
    expect((await store.load(statePath)).checkpointState).toEqual({
      census: "census after request 3",
    });
    expect(
      (await stagedSnapshots(database.client, store, RUN_ID)).vins,
    ).toEqual(["1FAHP2J89EG117591", "1FAHP2J89EG117592", "1FAHP2J89EG117593"]);

    // Cleanup of the released run removes every blob.
    await database.client.execute(
      `update ingestion_run set active_slot = null, status = 'error' where id = '${RUN_ID}'`,
    );
    await repository.cleanupStaleSnapshots();
    expect(store.pathnames()).toEqual([]);
  } finally {
    database.cleanup();
  }
});

test("a failed or lost checkpoint leaves the previous cursor paired with its own state", async () => {
  const { database, store, repository, registered } = await setup();
  try {
    const first = await repository.checkpointChunk({
      runId: RUN_ID,
      requestedCursor: HollanderstoresDurableCursor.initial(),
      fetched: hollanderChunk(1, ["1FAHP2J89EG117591"]),
    });
    const firstState = statePathOf(first.cursor);
    const committed = store.pathnames();
    const request = {
      runId: RUN_ID,
      requestedCursor: first.cursor,
      fetched: hollanderChunk(2, ["1FAHP2J89EG117592"]),
    };
    const expectFirstCheckpointIntact = async () => {
      expect(store.pathnames()).toEqual(committed);
      expect(
        await repository.getCheckpoint({
          runId: RUN_ID,
          requestedCursor: first.cursor,
        }),
      ).toBeNull();
      expect((await store.load(firstState)).checkpointState).toEqual({
        census: "census after request 1",
      });
    };

    // The vehicle chunk is staged, then the state write fails.
    const stateRejected = createDurableIngestionRepository(
      drizzle(database.client),
      database.client,
      {
        ...store,
        putCheckpointState: async () => {
          throw new Error("state rejected");
        },
      },
    );
    await expect(stateRejected.checkpointChunk(request)).rejects.toThrow(
      "state rejected",
    );
    await expectFirstCheckpointIntact();

    // Both blobs are staged, then the guarded checkpoint fails.
    await database.client.executeMultiple(
      "create trigger reject_checkpoint before update on ingestion_source_run begin select raise(abort, 'checkpoint rejected'); end;",
    );
    await expect(repository.checkpointChunk(request)).rejects.toThrow(
      "checkpoint rejected",
    );
    await expectFirstCheckpointIntact();
    await database.client.execute("drop trigger reject_checkpoint");

    // Two attempts race from the same cursor: one commits, the other loses.
    const [a, b] = await Promise.all([
      repository.checkpointChunk(request),
      repository.checkpointChunk({
        ...request,
        fetched: {
          ...hollanderChunk(2, ["1FAHP2J89EG117593"]),
          checkpointState: { census: "second census" },
        },
      }),
    ]);
    expect(a.cursor).toEqual(b.cursor);
    const winner = statePathOf(a.cursor);
    const secondWon = isDeepStrictEqual(
      (await store.load(winner)).checkpointState,
      { census: "second census" },
    );
    // The committed chunk is the one staged with the committed state.
    expect(
      (await stagedSnapshots(database.client, store, RUN_ID)).vins,
    ).toEqual(
      secondWon
        ? ["1FAHP2J89EG117591", "1FAHP2J89EG117593"]
        : ["1FAHP2J89EG117591", "1FAHP2J89EG117592"],
    );
    // Only the winner's blobs were added, and its state replaced the first.
    expect(store.pathnames().filter(isState)).toEqual([winner]);
    expect(store.pathnames().sort()).toEqual((await registered()).sort());
    expect(store.pathnames()).toHaveLength(3);
  } finally {
    database.cleanup();
  }
});

test("chunks that embedded their state before the split still resume and load", async () => {
  const { database, store, repository, registered } = await setup();
  try {
    // A run in flight at deploy: its chunk carries vehicles and the census.
    const legacy = await store.put({
      runId: RUN_ID,
      source: "hollanderstores",
      chunk: {
        vehicles: [
          {
            ...makeVehicle("1FAHP2J89EG117591"),
            source: "hollanderstores",
          },
        ],
        observedVins: [],
        checkpointState: { census: "legacy census" },
      },
    });
    const legacyCursor = { ...decoding(1), statePath: legacy };
    await database.client.execute({
      sql: "update ingestion_source_run set next_cursor = ?, snapshot_chunks = ? where id = ?",
      args: [
        HollanderstoresDurableCursor.serialize(legacyCursor),
        JSON.stringify([legacy]),
        SOURCE_RUN_ID,
      ],
    });
    expect((await store.load(legacy)).checkpointState).toEqual({
      census: "legacy census",
    });

    const next = await repository.checkpointChunk({
      runId: RUN_ID,
      requestedCursor: legacyCursor,
      fetched: hollanderChunk(2, ["1FAHP2J89EG117592"]),
    });

    // A legacy chunk is an ordinary chunk, so it is never treated as
    // superseded state and its vehicles still count.
    expect(store.pathnames()).toContain(legacy);
    expect(await registered()).toContain(legacy);
    expect(
      (await stagedSnapshots(database.client, store, RUN_ID)).vins,
    ).toEqual(["1FAHP2J89EG117591", "1FAHP2J89EG117592"]);
    expect(
      (await store.load(statePathOf(next.cursor))).checkpointState,
    ).toEqual({ census: "census after request 2" });
  } finally {
    database.cleanup();
  }
});

test("a state blob this source run did not register is never deleted", async () => {
  const { database, store, repository } = await setup();
  try {
    // URG resumes from an earlier run's retained census.
    const earlier = await store.putCheckpointState({
      runId: "earlier-run",
      source: "hollanderstores",
      state: { census: "earlier census" },
    });
    const cursor = { ...decoding(1), statePath: earlier };
    await database.client.execute({
      sql: "update ingestion_source_run set next_cursor = ? where id = ?",
      args: [HollanderstoresDurableCursor.serialize(cursor), SOURCE_RUN_ID],
    });

    await repository.checkpointChunk({
      runId: RUN_ID,
      requestedCursor: cursor,
      fetched: hollanderChunk(2, []),
    });

    expect(store.pathnames()).toContain(earlier);
  } finally {
    database.cleanup();
  }
});

test("reconciliation loads every vehicle chunk once and never checkpoint state", async () => {
  const { database, store, repository, registered } = await setup();
  try {
    let cursor: HollanderCursor = HollanderstoresDurableCursor.initial();
    for (const requests of [1, 2, 3]) {
      const saved = await repository.checkpointChunk({
        runId: RUN_ID,
        requestedCursor: cursor,
        fetched: hollanderChunk(requests, [`1FAHP2J89EG11759${requests}`]),
      });
      cursor = saved.cursor;
    }
    await database.client.execute(
      `update ingestion_source_run set status = 'success', acceptance_status = 'accepted' where id = '${SOURCE_RUN_ID}'`,
    );
    const loads: string[] = [];
    const counting: IngestionSnapshotStore = {
      ...store,
      load: async (path) => {
        loads.push(path);
        return store.load(path);
      },
    };
    const params = {
      runId: RUN_ID,
      database: drizzle(database.client),
      store: counting,
    };

    const inventory = await loadRunSnapshotInventory(params);
    // A later reconciliation step reuses the process's load.
    await loadRunSnapshotInventory(params);

    expect(inventory.vins).toHaveLength(3);
    expect(loads.filter(isState)).toEqual([]);
    expect(loads).toEqual(
      (await registered()).filter((path) => !isState(path)),
    );
  } finally {
    database.cleanup();
  }
});

test("census-only checkpoints stage no vehicle chunk, so a run keeps two blobs", async () => {
  const { store, repository, registered, database } = await setup();
  try {
    // Production Hollander runs checkpoint about 548 times; every checkpoint
    // but the last carries the census and no vehicles.
    let cursor: HollanderCursor = HollanderstoresDurableCursor.initial();
    for (const requests of [1, 2, 3, 4]) {
      const saved = await repository.checkpointChunk({
        runId: RUN_ID,
        requestedCursor: cursor,
        fetched: hollanderChunk(
          requests,
          requests === 4 ? ["1FAHP2J89EG117591"] : [],
        ),
      });
      cursor = saved.cursor;
    }

    const paths = await registered();
    expect(paths.filter((path) => !isState(path))).toHaveLength(1);
    expect(paths.filter(isState)).toEqual([statePathOf(cursor)]);
    expect(store.pathnames().sort()).toEqual([...paths].sort());
  } finally {
    database.cleanup();
  }
});

test("a replayed step holding the cursor of deleted state gets the newer checkpoint", async () => {
  const { database, store, repository } = await setup();
  try {
    const first = await repository.checkpointChunk({
      runId: RUN_ID,
      requestedCursor: HollanderstoresDurableCursor.initial(),
      fetched: hollanderChunk(1, []),
    });
    const second = await repository.checkpointChunk({
      runId: RUN_ID,
      requestedCursor: first.cursor,
      fetched: hollanderChunk(2, []),
    });
    // The first state is gone once the second checkpoint committed.
    expect(store.pathnames()).not.toContain(statePathOf(first.cursor));

    // A Workflow retry of the second step still holds the first cursor. It
    // must resume from the committed checkpoint, never load the first state.
    const replayed = await repository.getCheckpoint({
      runId: RUN_ID,
      requestedCursor: first.cursor,
    });
    expect(replayed?.cursor).toEqual(second.cursor);
    // A late checkpoint from that older cursor loses and changes nothing.
    const late = await repository.checkpointChunk({
      runId: RUN_ID,
      requestedCursor: first.cursor,
      fetched: hollanderChunk(2, ["1FAHP2J89EG117599"]),
    });
    expect(late.cursor).toEqual(second.cursor);
    expect(store.pathnames().filter(isState)).toEqual([
      statePathOf(second.cursor),
    ]);
    expect(
      (await stagedSnapshots(database.client, store, RUN_ID)).vins,
    ).toEqual([]);
  } finally {
    database.cleanup();
  }
});

test("a checkpoint whose commit landed but whose response was lost keeps its blobs", async () => {
  const { database, store, registered } = await setup();
  try {
    const repository = createDurableIngestionRepository(
      drizzle(database.client),
      database.client,
      store,
    );
    const first = await repository.checkpointChunk({
      runId: RUN_ID,
      requestedCursor: HollanderstoresDurableCursor.initial(),
      fetched: hollanderChunk(1, []),
    });
    const lostResponse = createDurableIngestionRepository(
      drizzle(database.client),
      {
        batch: async (statements, mode) => {
          await database.client.batch(statements, mode);
          throw new Error("response lost");
        },
      },
      store,
    );

    await expect(
      lostResponse.checkpointChunk({
        runId: RUN_ID,
        requestedCursor: first.cursor,
        fetched: hollanderChunk(2, ["1FAHP2J89EG117592"]),
      }),
    ).rejects.toThrow("response lost");

    // The retry resumes from the committed checkpoint, whose blobs exist,
    // and the state it replaced is gone.
    const saved = await repository.getCheckpoint({
      runId: RUN_ID,
      requestedCursor: first.cursor,
    });
    if (!saved) throw new Error("The committed checkpoint was not found");
    expect(
      (await store.load(statePathOf(saved.cursor))).checkpointState,
    ).toEqual({ census: "census after request 2" });
    expect(store.pathnames()).not.toContain(statePathOf(first.cursor));
    expect(store.pathnames().sort()).toEqual((await registered()).sort());
    expect(
      (await stagedSnapshots(database.client, store, RUN_ID)).vins,
    ).toEqual(["1FAHP2J89EG117592"]);
  } finally {
    database.cleanup();
  }
});

test("a checkpoint whose superseded state delete is rate limited returns at once without sleeping", async () => {
  const database = createTestClient();
  const logged = spyOn(console, "error").mockImplementation(() => {});
  try {
    await database.client.executeMultiple(TEST_SCHEMA);
    const sleeps: number[] = [];
    const deletes: string[][] = [];
    let suffix = 0;
    const store = IngestionSnapshotStore.vercelBlob(
      "local-test-token",
      {
        get: async () => null,
        async put(pathname) {
          suffix += 1;
          return {
            pathname: pathname.replace(".json.gz", `-${suffix}.json.gz`),
            url: "",
            downloadUrl: "",
            contentType: "application/gzip",
            contentDisposition: "",
            etag: "etag",
          };
        },
        async del(urls) {
          deletes.push(typeof urls === "string" ? [urls] : urls);
          throw new BlobServiceRateLimited(60);
        },
      },
      async (ms) => {
        sleeps.push(ms);
      },
    );
    const repository = createDurableIngestionRepository(
      drizzle(database.client),
      database.client,
      store,
    );
    await repository.initialize(RUN_ID, async () => ["hollanderstores"]);
    const first = await repository.checkpointChunk({
      runId: RUN_ID,
      requestedCursor: HollanderstoresDurableCursor.initial(),
      fetched: hollanderChunk(1, []),
    });

    const second = await repository.checkpointChunk({
      runId: RUN_ID,
      requestedCursor: first.cursor,
      fetched: hollanderChunk(2, ["1FAHP2J89EG117592"]),
    });

    expect(statePathOf(second.cursor)).not.toBe(statePathOf(first.cursor));
    expect(deletes).toEqual([[statePathOf(first.cursor)]]);
    expect(sleeps).toEqual([]);
    expect(String(logged.mock.calls[0]?.[0])).toContain(
      "Could not delete superseded checkpoint state",
    );
  } finally {
    logged.mockRestore();
    database.cleanup();
  }
});
