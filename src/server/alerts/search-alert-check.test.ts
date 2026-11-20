import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import type {
  AlertMatchBound,
  AlertMatchSearch,
} from "~/lib/alert-match-search";
import type { AlertMatchStats } from "~/lib/algolia-alert-search";
import { createTestClient } from "~/server/ingestion/durable-ingestion-test-fixtures";
import { releaseLegacyAlertMatchingRun } from "~/server/ingestion/projection-release";
import {
  runSearchAlertCheckBatch,
  type SearchAlertCheckContext,
} from "./search-alert-check";

const SCHEMA = `
  create table user (id text primary key);
  insert into user values ('user-1');
  create table ingestion_run (
    id text primary key, source text not null, status text not null,
    stage text not null, active_slot integer, commit_started_at integer,
    full_reindex_required integer not null default 0,
    publication_sequence integer, started_at integer not null,
    search_published_at integer, released_at integer, completed_at integer,
    last_progress_at integer not null default 0
  );
  create table vehicle (vin text primary key, first_seen_at integer not null);
  create table saved_search (
    id text primary key, user_id text not null, name text not null,
    query text not null, filters text not null,
    email_alerts_enabled integer not null default 0,
    discord_alerts_enabled integer not null default 0,
    search_match_version integer not null default 1,
    email_config_version integer not null default 1,
    discord_config_version integer not null default 1,
    email_start_sequence integer not null default 0,
    discord_start_sequence integer not null default 0,
    last_matched_publication_sequence integer not null default 0,
    last_checked_at integer, alert_quarantined_at integer,
    alert_quarantine_reason text, processing_lock integer,
    created_at integer not null default 0, updated_at integer not null default 0
  );
  create table search_alert_check (
    id text primary key, day text not null unique, status text not null,
    checked_through integer not null, search_cursor text,
    started_at integer not null,
    last_progress_at integer not null, completed_at integer
  );
  create table search_notification_intent (
    id text primary key,
    run_id text references ingestion_run(id) on delete cascade,
    alert_check_id text references search_alert_check(id) on delete cascade,
    publication_sequence integer not null, saved_search_id text not null,
    user_id text not null, channel text not null,
    search_match_version integer not null,
    channel_config_version integer not null, payload text not null,
    status text not null default 'pending',
    attempts integer not null default 0, created_at integer not null,
    check ((run_id is null) <> (alert_check_id is null))
  );
  create unique index search_notification_intent_dedupe_idx
    on search_notification_intent (saved_search_id, publication_sequence, channel);
`;

const DAY = "2026-11-20";
const NOW = new Date("2026-11-20T18:00:00.400Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;

type MatchCall = { searches: AlertMatchSearch[]; bound: AlertMatchBound };

async function setup(options?: {
  onMatch?: (call: MatchCall) => Promise<void>;
}) {
  const { client, cleanup } = createTestClient();
  await client.executeMultiple(SCHEMA);
  const calls: MatchCall[] = [];
  const counts = new Map<string, number>();
  const context: SearchAlertCheckContext = {
    database: drizzle(client),
    client,
    appUrl: "https://example.test",
    async matchSearches(searches, bound) {
      calls.push({ searches: [...searches], bound });
      await options?.onMatch?.({ searches: [...searches], bound });
      return searches.map(
        (search): PromiseSettledResult<AlertMatchStats> => ({
          status: "fulfilled",
          value: {
            matchedCount: counts.get(search.query) ?? 0,
            completion: { status: "complete" },
            vehicles: [],
          },
        }),
      );
    },
  };
  return { client, cleanup, calls, counts, context };
}

async function insertSearch(
  client: Awaited<ReturnType<typeof setup>>["client"],
  id: string,
  lastCheckedAt: number | null,
) {
  await client.execute({
    sql: `insert into saved_search (
      id, user_id, name, query, filters, email_alerts_enabled,
      discord_alerts_enabled, last_checked_at
    ) values (?, 'user-1', ?, ?, '{}', 1, 0, ?)`,
    args: [id, id, id, lastCheckedAt],
  });
}

async function insertRun(
  client: Awaited<ReturnType<typeof setup>>["client"],
  run: {
    id: string;
    source?: string;
    status: string;
    stage: string;
    activeSlot: 1 | null;
    commitStartedAt: number | null;
    fullReindexRequired?: boolean;
    publicationSequence?: number | null;
    startedAt?: number;
    searchPublishedAt?: number | null;
  },
) {
  await client.execute({
    sql: `insert into ingestion_run (
      id, source, status, stage, active_slot, commit_started_at,
      full_reindex_required, publication_sequence, started_at,
      search_published_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      run.id,
      run.source ?? "pyp",
      run.status,
      run.stage,
      run.activeSlot,
      run.commitStartedAt,
      Number(run.fullReindexRequired ?? false),
      run.publicationSequence ?? null,
      run.startedAt ?? run.commitStartedAt ?? 0,
      run.searchPublishedAt ?? null,
    ],
  });
}

async function checks(client: Awaited<ReturnType<typeof setup>>["client"]) {
  return (
    await client.execute(
      "select day, status, checked_through, search_cursor from search_alert_check order by day",
    )
  ).rows;
}

async function searchWindows(
  client: Awaited<ReturnType<typeof setup>>["client"],
) {
  return (
    await client.execute(
      "select id, last_checked_at from saved_search order by id",
    )
  ).rows.map((row) => [row.id, row.last_checked_at]);
}

describe("daily search alert check", () => {
  test("matches every alert-enabled search in one batched request once per day", async () => {
    const { client, cleanup, calls, counts, context } = await setup();
    try {
      await insertRun(client, {
        id: "published",
        status: "success",
        stage: "released",
        activeSlot: null,
        commitStartedAt: NOW.getTime() - 3 * 60 * MINUTE,
        publicationSequence: 9,
      });
      await client.execute({
        sql: "insert into vehicle values ('VIN1', ?)",
        args: [NOW.getTime() - 3 * 60 * MINUTE],
      });
      const yesterday = NOW.getTime() - 24 * 60 * MINUTE;
      await insertSearch(client, "search-a", yesterday);
      await insertSearch(client, "search-b", yesterday);
      counts.set("search-a", 2);

      const first = await runSearchAlertCheckBatch(context, DAY, NOW);
      expect(first).toMatchObject({
        status: "complete",
        searchesProcessed: 2,
        intentsCreated: 1,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.searches.map((search) => search.query)).toEqual([
        "search-a",
        "search-b",
      ]);
      // The bound trails creation by the claim margin, rounded to a second.
      const checkedThrough = Date.parse("2026-11-20T17:58:59.999Z");
      expect(calls[0]?.bound).toEqual({
        checkedThrough: new Date(checkedThrough),
        latestFirstSeenAt: new Date(NOW.getTime() - 3 * 60 * MINUTE),
      });
      expect(await checks(client)).toEqual([
        expect.objectContaining({
          day: DAY,
          status: "complete",
          checked_through: checkedThrough,
        }),
      ]);
      expect(await searchWindows(client)).toEqual([
        ["search-a", checkedThrough],
        ["search-b", checkedThrough],
      ]);
      const intents = await client.execute(
        "select id, run_id, alert_check_id, saved_search_id, channel, publication_sequence from search_notification_intent",
      );
      expect(intents.rows).toEqual([
        expect.objectContaining({
          run_id: null,
          alert_check_id: expect.any(String),
          saved_search_id: "search-a",
          channel: "email",
          publication_sequence: 9,
        }),
      ]);

      // Later triggers the same day find the check done and query nothing.
      const again = await runSearchAlertCheckBatch(
        context,
        DAY,
        new Date(NOW.getTime() + 60 * MINUTE),
      );
      expect(again).toMatchObject({ status: "complete", searchesProcessed: 0 });
      expect(calls).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  test("bounds the window before commits that are not searchable yet and starts the next day there", async () => {
    const { client, cleanup, calls, context } = await setup();
    try {
      const abandonedCommit = Date.parse("2026-11-20T12:00:00.500Z");
      await insertRun(client, {
        id: "abandoned",
        status: "abandoned",
        stage: "reconcile_upsert",
        activeSlot: null,
        commitStartedAt: abandonedCommit,
        fullReindexRequired: true,
      });
      await insertRun(client, {
        id: "rebuilding",
        status: "running",
        stage: "full_reindex_load",
        activeSlot: 1,
        commitStartedAt: Date.parse("2026-11-20T13:00:00.000Z"),
        publicationSequence: 12,
      });
      // Waiting runs have not stamped anything.
      await insertRun(client, {
        id: "queued",
        status: "running",
        stage: "reconcile_upsert",
        activeSlot: 1,
        commitStartedAt: null,
        startedAt: Date.parse("2026-11-20T08:00:00.000Z"),
      });
      await insertSearch(
        client,
        "search-a",
        Date.parse("2026-11-19T18:00:00Z"),
      );

      expect(await runSearchAlertCheckBatch(context, DAY, NOW)).toMatchObject({
        status: "complete",
      });
      const checkedThrough = Date.parse("2026-11-20T11:59:59.999Z");
      expect(calls[0]?.bound.checkedThrough).toEqual(new Date(checkedThrough));
      expect(await checks(client)).toEqual([
        expect.objectContaining({ checked_through: checkedThrough }),
      ]);
      expect(await searchWindows(client)).toEqual([
        ["search-a", checkedThrough],
      ]);

      // Once the rebuild publishes, the next day's window starts at the bound,
      // so the abandoned commit's vehicles are matched then.
      await client.execute(
        "update ingestion_run set full_reindex_required = 0, active_slot = null, status = case id when 'rebuilding' then 'success' else status end",
      );
      const tomorrow = new Date("2026-11-21T18:00:00.400Z");
      expect(
        await runSearchAlertCheckBatch(context, "2026-11-21", tomorrow),
      ).toMatchObject({ status: "complete" });
      expect(calls[1]?.searches[0]?.lastCheckedAt).toEqual(
        new Date(checkedThrough),
      );
      expect(calls[1]?.bound.checkedThrough).toEqual(
        new Date("2026-11-21T17:58:59.999Z"),
      );
    } finally {
      cleanup();
    }
  });

  test("counts an unclaimed local run from its start", async () => {
    const { client, cleanup, calls, context } = await setup();
    try {
      await insertRun(client, {
        id: "local",
        source: "all",
        status: "running",
        stage: "project_changes",
        activeSlot: 1,
        commitStartedAt: null,
        startedAt: Date.parse("2026-11-20T15:30:00.250Z"),
      });
      await insertSearch(
        client,
        "search-a",
        Date.parse("2026-11-19T18:00:00Z"),
      );
      await runSearchAlertCheckBatch(context, DAY, NOW);
      expect(calls[0]?.bound.checkedThrough).toEqual(
        new Date("2026-11-20T15:29:59.999Z"),
      );
    } finally {
      cleanup();
    }
  });

  test("waits without querying Algolia while a run from the previous release matches alerts", async () => {
    const { client, cleanup, calls, context } = await setup();
    try {
      await insertRun(client, {
        id: "legacy",
        status: "running",
        stage: "match_alerts",
        activeSlot: 1,
        commitStartedAt: Date.parse("2026-11-20T17:00:00Z"),
        publicationSequence: 4,
      });
      const lastChecked = Date.parse("2026-11-19T18:00:00Z");
      await insertSearch(client, "search-a", lastChecked);

      expect(await runSearchAlertCheckBatch(context, DAY, NOW)).toMatchObject({
        status: "waiting",
      });
      expect(calls).toHaveLength(0);
      expect(await searchWindows(client)).toEqual([["search-a", lastChecked]]);

      // The new release's projector releases the run without matching.
      expect(
        await releaseLegacyAlertMatchingRun({
          database: context.database,
          runId: "legacy",
          searchPublishedAt: null,
          now: new Date(NOW.getTime() + 5 * MINUTE),
        }),
      ).toMatchObject({ status: "complete" });
      expect(
        await runSearchAlertCheckBatch(
          context,
          DAY,
          new Date(NOW.getTime() + 10 * MINUTE),
        ),
      ).toMatchObject({ status: "complete", searchesProcessed: 1 });
      // The bound was fixed before the legacy run's commit.
      expect(calls[0]?.bound.checkedThrough).toEqual(
        new Date("2026-11-20T16:59:59.999Z"),
      );
    } finally {
      cleanup();
    }
  });

  test("keeps windows when a run from the previous release starts matching while the batch reads Algolia", async () => {
    const lastChecked = Date.parse("2026-11-19T18:00:00Z");
    let entered = false;
    const { client, cleanup, calls, counts, context } = await setup({
      async onMatch() {
        if (entered) return;
        entered = true;
        // An old-deployment run finished projecting and entered matching.
        await client.execute({
          sql: `insert into ingestion_run (
            id, source, status, stage, active_slot, commit_started_at,
            full_reindex_required, publication_sequence, started_at
          ) values ('legacy', 'pyp', 'running', 'match_alerts', 1, ?, 0, 5, ?)`,
          args: [NOW.getTime(), NOW.getTime()],
        });
      },
    });
    try {
      await insertSearch(client, "search-a", lastChecked);
      counts.set("search-a", 1);

      expect(await runSearchAlertCheckBatch(context, DAY, NOW)).toMatchObject({
        status: "waiting",
      });
      expect(await searchWindows(client)).toEqual([["search-a", lastChecked]]);
      expect(
        (
          await client.execute(
            "select count(*) as n from search_notification_intent",
          )
        ).rows[0]?.n,
      ).toBe(0);

      // Still matching: the next batch waits before reading Algolia.
      expect(
        await runSearchAlertCheckBatch(
          context,
          DAY,
          new Date(NOW.getTime() + 10 * MINUTE),
        ),
      ).toMatchObject({ status: "waiting" });
      expect(calls).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  test("keeps windows when a commit inside them publishes while the batch reads Algolia", async () => {
    const lastChecked = Date.parse("2026-11-19T18:00:00Z");
    let published = false;
    const { client, cleanup, calls, counts, context } = await setup({
      async onMatch() {
        if (published) return;
        published = true;
        // A claim stamped before the bound landed after the check was created.
        await client.execute({
          sql: `insert into ingestion_run (
            id, source, status, stage, active_slot, commit_started_at,
            full_reindex_required, publication_sequence, started_at,
            search_published_at
          ) values ('late', 'pyp', 'success', 'released', null, ?, 0, 3, ?, ?)`,
          args: [
            Date.parse("2026-11-20T17:58:30Z"),
            Date.parse("2026-11-20T17:58:30Z"),
            NOW.getTime() + SECOND,
          ],
        });
      },
    });
    try {
      await insertSearch(client, "search-a", lastChecked);
      counts.set("search-a", 1);

      expect(await runSearchAlertCheckBatch(context, DAY, NOW)).toMatchObject({
        status: "waiting",
      });
      expect(await searchWindows(client)).toEqual([["search-a", lastChecked]]);
      expect(
        (
          await client.execute(
            "select count(*) as n from search_notification_intent",
          )
        ).rows[0]?.n,
      ).toBe(0);

      // A later read sees the published vehicles and advances the window.
      expect(
        await runSearchAlertCheckBatch(
          context,
          DAY,
          new Date(NOW.getTime() + 10 * MINUTE),
        ),
      ).toMatchObject({ status: "complete", intentsCreated: 1 });
      expect(calls).toHaveLength(2);
      // The intent carries the late commit's newer sequence.
      expect(
        (
          await client.execute(
            "select publication_sequence from search_notification_intent",
          )
        ).rows,
      ).toEqual([expect.objectContaining({ publication_sequence: 3 })]);
      expect(await searchWindows(client)).toEqual([
        ["search-a", Date.parse("2026-11-20T17:58:59.999Z")],
      ]);
    } finally {
      cleanup();
    }
  });

  test("skips a search edited during the check and never moves a window backward", async () => {
    const { client, cleanup, counts, context } = await setup({
      async onMatch() {
        await client.execute(
          "update saved_search set search_match_version = 2, last_checked_at = ? where id = 'edited'",
          [NOW.getTime()],
        );
      },
    });
    try {
      const lastChecked = Date.parse("2026-11-19T18:00:00Z");
      await insertSearch(client, "edited", lastChecked);
      // Enabled after the bound: its window starts at the enable time.
      await insertSearch(client, "fresh", NOW.getTime() - SECOND);
      counts.set("edited", 3);

      expect(await runSearchAlertCheckBatch(context, DAY, NOW)).toMatchObject({
        status: "complete",
        intentsCreated: 0,
      });
      expect(await searchWindows(client)).toEqual([
        ["edited", NOW.getTime()],
        ["fresh", NOW.getTime() - SECOND],
      ]);
    } finally {
      cleanup();
    }
  });

  test("keeps a window whose alert would share an earlier intent's sequence until a newer one exists", async () => {
    const { client, cleanup, calls, counts, context } = await setup();
    try {
      const lastChecked = Date.parse("2026-11-19T17:58:59.999Z");
      await insertRun(client, {
        id: "earlier",
        status: "success",
        stage: "released",
        activeSlot: null,
        commitStartedAt: Date.parse("2026-11-19T12:00:00Z"),
        publicationSequence: 7,
      });
      await insertSearch(client, "search-a", lastChecked);
      // Yesterday's check alerted under sequence 7. Today's new vehicles came
      // from an abandoned commit that a rebuild outside the window published,
      // so the window's newest released sequence is still 7.
      await client.execute(`insert into search_alert_check values (
        'yesterday', '2026-11-19', 'complete', ${lastChecked}, 'search-a', 0, 0, 0
      )`);
      await client.execute(`insert into search_notification_intent (
        id, alert_check_id, publication_sequence, saved_search_id, user_id,
        channel, search_match_version, channel_config_version, payload,
        created_at
      ) values ('old', 'yesterday', 7, 'search-a', 'user-1', 'email', 1, 1, '{}', 0)`);
      counts.set("search-a", 2);

      expect(await runSearchAlertCheckBatch(context, DAY, NOW)).toMatchObject({
        status: "complete",
        intentsCreated: 0,
      });
      expect(await searchWindows(client)).toEqual([["search-a", lastChecked]]);

      await insertRun(client, {
        id: "newer",
        status: "success",
        stage: "released",
        activeSlot: null,
        commitStartedAt: Date.parse("2026-11-20T19:00:00Z"),
        publicationSequence: 8,
      });
      const tomorrow = new Date("2026-11-21T18:00:00.400Z");
      expect(
        await runSearchAlertCheckBatch(context, "2026-11-21", tomorrow),
      ).toMatchObject({ status: "complete", intentsCreated: 1 });
      expect(calls[1]?.searches[0]?.lastCheckedAt).toEqual(
        new Date(lastChecked),
      );
      expect(
        (
          await client.execute(
            "select publication_sequence from search_notification_intent where id <> 'old'",
          )
        ).rows,
      ).toEqual([expect.objectContaining({ publication_sequence: 8 })]);
    } finally {
      cleanup();
    }
  });

  test("supersedes an unfinished earlier check and skips a past day that never started", async () => {
    const { client, cleanup, calls, context } = await setup();
    try {
      await insertSearch(
        client,
        "search-a",
        Date.parse("2026-11-18T18:00:00Z"),
      );
      await client.execute(`insert into search_alert_check values (
        'yesterday', '2026-11-19', 'running', ${Date.parse("2026-11-19T17:59:00Z")},
        null, 0, 0, null
      )`);
      expect(
        await runSearchAlertCheckBatch(context, "2026-11-18", NOW),
      ).toEqual({ status: "not_started" });

      await runSearchAlertCheckBatch(context, DAY, NOW);
      expect(
        (await checks(client)).map((row) => [row.day, row.status]),
      ).toEqual([
        ["2026-11-19", "superseded"],
        [DAY, "complete"],
      ]);
      // The superseded check's worker stops instead of writing.
      expect(
        await runSearchAlertCheckBatch(context, "2026-11-19", NOW),
      ).toEqual({ status: "stopped", checkId: "yesterday" });
      expect(calls).toHaveLength(1);
    } finally {
      cleanup();
    }
  });
});
