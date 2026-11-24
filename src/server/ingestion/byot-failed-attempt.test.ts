import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Effect } from "effect";
import { streamByotInventory } from "./byot-connector";
import {
  BYOT_CHUNK_REQUESTS,
  BYOT_MAX_RUN_MS,
  ByotCursor,
} from "./byot-cursor";
import { BYOT_ARRIVALS_URL, byotSearchUrl } from "./byot-directory";
import { BYOT_YARDS } from "./byot-configuration";
import { loadByotFailedAttemptCursor } from "./byot-history";
import {
  byotFixtureFeeds,
  byotTerminal,
  byotValue,
} from "./byot-test-fixtures";

const hour = 3_600_000;
// 08:00 UTC, one hour into the November 16 ingestion day.
const startedAt = Date.UTC(2026, 10, 16, 8);
const published = byotTerminal(0, Date.UTC(2026, 10, 15, 8));
const empty = JSON.stringify({
  search_id: null,
  data: { availableVehicles: [], compatibleVehicles: [] },
});

/** The last checkpoint of an attempt that sent one full chunk, on the wire. */
async function failedAttempt(previous = published, at = startedAt) {
  const result = await Effect.runPromise(
    streamByotInventory({
      startCursor: ByotCursor.initial(),
      previousCursor: previous,
      now: at,
      maxPages: BYOT_CHUNK_REQUESTS,
      readPage: (url, code) =>
        Effect.succeed(
          url === BYOT_ARRIVALS_URL
            ? JSON.stringify(byotFixtureFeeds[code] ?? [])
            : empty,
        ),
      onBatch: () => Effect.void,
    }),
  );
  return {
    cursor: result.cursor,
    wire: byotValue(ByotCursor.serialize(result.cursor)),
  };
}

/** Runs one chunk that records each request and lists nothing. */
function chunk(
  options: Pick<
    Parameters<typeof streamByotInventory>[0],
    "startCursor" | "previousCursor" | "failedAttemptCursor" | "now"
  >,
  requests: string[] = [],
) {
  return Effect.runPromise(
    Effect.either(
      streamByotInventory({
        ...options,
        maxPages: BYOT_CHUNK_REQUESTS,
        readPage: (url, code) =>
          Effect.sync(() => {
            requests.push(url);
            return url === BYOT_ARRIVALS_URL
              ? JSON.stringify(byotFixtureFeeds[code] ?? [])
              : empty;
          }),
        onBatch: () => Effect.void,
      }),
    ),
  );
}

test("a retry continues a failed attempt from its last checkpoint when the same day's sweep can still finish in time", async () => {
  const failed = await failedAttempt();
  if (failed.cursor.phase !== "search") throw new Error("Missing sweep");
  const retryAt = startedAt + 2 * hour;
  const requests: string[] = [];
  const retried = await chunk(
    {
      startCursor: ByotCursor.initial(),
      previousCursor: published,
      failedAttemptCursor: failed.wire,
      now: retryAt,
    },
    requests,
  );
  if (retried._tag === "Left") throw new Error(retried.left.message);
  // The first request is the failed attempt's next search, not a yard feed.
  const nextYard = BYOT_YARDS[failed.cursor.progress % BYOT_YARDS.length];
  if (!nextYard) throw new Error("Missing yard");
  expect(requests[0]).toBe(
    byotSearchUrl(
      nextYard.code,
      Math.floor(failed.cursor.progress / BYOT_YARDS.length),
    ),
  );
  expect(requests).not.toContain(BYOT_ARRIVALS_URL);
  // Evidence keeps the failed attempt's start; pace restarts at the retry.
  expect(retried.right.cursor).toMatchObject({
    phase: "search",
    startedAt,
    progress: failed.cursor.progress + BYOT_CHUNK_REQUESTS,
    paceFrom: { at: retryAt, sent: BYOT_CHUNK_REQUESTS },
  });
});

test("a chunk fails before sending when the attempt's observed pace cannot finish inside the run limit", async () => {
  const failed = await failedAttempt();
  // 64 requests took 640 s, so 10 s each: 6,631 more need about 18 hours.
  // It fails before sending, so a step retry of it sends nothing either.
  const sent: string[] = [];
  const slow = await chunk(
    {
      startCursor: failed.cursor,
      now: startedAt + BYOT_CHUNK_REQUESTS * 10_000,
    },
    sent,
  );
  expect(slow._tag).toBe("Left");
  expect(sent).toEqual([]);
  if (slow._tag === "Left") {
    expect(slow.left.message).toContain("observed 10.0 s per request");
    expect(slow.left.message).toContain("published inventory is unchanged");
  }
  const requests: string[] = [];
  const steady = await chunk(
    {
      startCursor: failed.cursor,
      now: startedAt + BYOT_CHUNK_REQUESTS * 2_700,
    },
    requests,
  );
  expect(steady._tag).toBe("Right");
  expect(requests).toHaveLength(BYOT_CHUNK_REQUESTS);
});

test("a retry starts a fresh sweep when the failed attempt cannot be resumed", async () => {
  const failed = await failedAttempt();
  const fresh = (wire: string, previous: ByotCursor | null, now: number) => {
    const resumption = ByotCursor.resume(wire, previous, now);
    expect(resumption.kind).toBe("fresh");
    return resumption.kind === "fresh" ? resumption.reason : "";
  };
  // Its remaining requests would end after the eight-hour limit.
  expect(fresh(failed.wire, published, startedAt + 6 * hour)).toContain(
    "8-hour limit",
  );
  // A later ingestion day sweeps again.
  const lateNight = await failedAttempt(published, Date.UTC(2026, 10, 17, 5));
  expect(
    fresh(lateNight.wire, published, Date.UTC(2026, 10, 17, 7, 30)),
  ).toContain("ingestion day");
  // It began from a different publication than the latest one.
  expect(
    fresh(
      failed.wire,
      byotTerminal(500, Date.UTC(2026, 10, 15, 8)),
      startedAt + hour,
    ),
  ).toContain("latest publication");
  expect(fresh(failed.wire, null, startedAt + hour)).toContain(
    "latest publication",
  );
  // A terminal or unreadable checkpoint holds no sweep to continue.
  expect(
    fresh(byotValue(ByotCursor.serialize(published)), published, startedAt),
  ).toContain("complete");
  expect(fresh("{", published, startedAt + hour)).toContain("checkpoint");
  // A failure after every search re-crawls, since a fresh crawl can change
  // data that failed snapshot validation.
  const begin = byotValue(ByotCursor.begin(published, startedAt));
  if (begin.phase !== "arrivals") throw new Error("Missing daily cursor");
  const swept = byotTerminal(0, startedAt, begin.cache);
  if (swept.phase !== "complete") throw new Error("Missing swept cursor");
  const ready = byotValue(
    ByotCursor.checkpoint({
      ...begin,
      phase: "ready",
      cache: swept.cache,
      feeds: BYOT_YARDS.map((yard) => byotFixtureFeeds[yard.code] ?? []),
    }),
  );
  expect(
    fresh(byotValue(ByotCursor.serialize(ready)), published, startedAt + hour),
  ).toContain("ready");
});

test("the newest failed BYOT run's checkpoint is offered for resumption, skipping failed runs that saved none, until a run succeeded", async () => {
  const client = createClient({ url: ":memory:" });
  const database = drizzle(client);
  const at = 10 * hour;
  try {
    await client.execute(
      "create table ingestion_source_run (id text primary key, run_id text, source text, status text, started_at integer, start_cursor text, next_cursor text)",
    );
    // The durable framework inserts each run with its start cursor as next.
    const initial = byotValue(ByotCursor.serialize(ByotCursor.initial()));
    expect(await loadByotFailedAttemptCursor(database, at)).toBeNull();
    const insert = (
      runId: string,
      source: string,
      status: string,
      startedAt: number,
      cursor: string | null,
    ) =>
      client.execute({
        sql: "insert into ingestion_source_run values (?, ?, ?, ?, ?, ?, ?)",
        args: [
          `${runId}-${source}`,
          runId,
          source,
          status,
          startedAt,
          initial,
          cursor,
        ],
      });
    await insert("published", "byot", "success", 5 * hour, "published");
    await insert("failed", "byot", "error", 6 * hour, "failed");
    await insert("current", "byot", "running", 9 * hour, "current");
    await insert("other", "pyp", "error", 9 * hour, "other");
    expect(await loadByotFailedAttemptCursor(database, at)).toBe("failed");
    await client.execute(
      "update ingestion_source_run set status = 'partial' where run_id = 'failed'",
    );
    expect(await loadByotFailedAttemptCursor(database, at)).toBe("failed");
    // A retry that failed before its first checkpoint saved only the initial
    // cursor, or none, so the checkpoint before it is still the latest.
    await insert("unstarted", "byot", "error", 7 * hour, initial);
    await insert("unsaved", "byot", "error", 8 * hour, null);
    expect(await loadByotFailedAttemptCursor(database, at)).toBe("failed");
    // A checkpoint from a run that began before the run limit cannot finish.
    expect(
      await loadByotFailedAttemptCursor(
        database,
        6 * hour + BYOT_MAX_RUN_MS + 1,
      ),
    ).toBeNull();
    await insert("rejected", "byot", "success", 6.5 * hour, "rejected");
    expect(await loadByotFailedAttemptCursor(database, at)).toBeNull();
  } finally {
    client.close();
  }
});
