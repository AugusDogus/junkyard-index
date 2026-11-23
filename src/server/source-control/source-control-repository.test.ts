import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import { HiddenSources } from "~/lib/hidden-source";
import { SourceControl } from "./source-control";
import { SourceControlRepository } from "./source-control-repository";

const migration = readFileSync(
  new URL("../../../drizzle/0030_source_control.sql", import.meta.url),
  "utf8",
);

let client: ReturnType<typeof createClient>;
let db: LibSQLDatabase;
beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  await client.executeMultiple(migration);
  await client.execute(
    "create table user (id text primary key, name text not null, email text not null)",
  );
  db = drizzle(client);
});
afterEach(() => client.close());

const now = new Date("2026-11-23T15:00:00Z");

describe("source_control migration", () => {
  test("keeps Meeks hidden with its reason from the first deploy", async () => {
    expect(await SourceControlRepository.hiddenSources(db)).toEqual(
      HiddenSources.of(["meeks"]),
    );
    const meeks = await SourceControlRepository.forSource(db, "meeks");
    expect(meeks.ingestion).toBe("running");
    expect(meeks.visibility).toEqual({
      status: "hidden",
      reason:
        "Since 2026-11-22 every meeksrecycling.com page serves an unrelated page that redirects visitors to another site.",
    });
    expect(meeks.lastChange?.byUserId).toBeNull();
  });

  test("refuses a hidden row without a reason", async () => {
    expect(
      client.execute(
        "insert into source_control (source, visibility, updated_at) values ('pyp', 'hidden', 0)",
      ),
    ).rejects.toThrow();
  });

  test("keeps the action log append-only", async () => {
    await SourceControlRepository.apply(db, {
      source: "pratt",
      change: { kind: "pause" },
      userId: "owner",
      now,
    });
    expect(
      client.execute("update admin_action_log set user_id = 'someone'"),
    ).rejects.toThrow(/append-only/);
    expect(client.execute("delete from admin_action_log")).rejects.toThrow(
      /append-only/,
    );
  });
});

describe("SourceControlRepository", () => {
  test("a source without a row runs and is shown", async () => {
    expect(await SourceControlRepository.forSource(db, "pyp")).toEqual({
      source: "pyp",
      ingestion: "running",
      visibility: { status: "shown" },
      lastChange: null,
    });
  });

  test("stores each change with a log entry, and logs nothing when unchanged", async () => {
    const paused = await SourceControlRepository.apply(db, {
      source: "pratt",
      change: { kind: "pause" },
      userId: "owner",
      now,
    });
    expect(paused.status).toBe("changed");
    expect(await SourceControlRepository.pausedSources(db)).toEqual(
      new Set(["pratt"]),
    );
    const again = await SourceControlRepository.apply(db, {
      source: "pratt",
      change: { kind: "pause" },
      userId: "owner",
      now,
    });
    expect(again.status).toBe("unchanged");

    await SourceControlRepository.apply(db, {
      source: "pratt",
      change: { kind: "hide", reason: "Site redirects to spam" },
      userId: "owner",
      now: new Date(now.getTime() + 1000),
    });
    expect((await SourceControlRepository.hiddenSources(db)).list).toEqual([
      "pratt",
      "meeks",
    ]);
    await SourceControlRepository.apply(db, {
      source: "meeks",
      change: { kind: "show" },
      userId: "owner",
      now: new Date(now.getTime() + 2000),
    });
    expect((await SourceControlRepository.hiddenSources(db)).list).toEqual([
      "pratt",
    ]);
    const pratt = await SourceControlRepository.forSource(db, "pratt");
    expect(pratt).toEqual({
      source: "pratt",
      ingestion: "paused",
      visibility: { status: "hidden", reason: "Site redirects to spam" },
      lastChange: { at: new Date(now.getTime() + 1000), byUserId: "owner" },
    });

    expect(
      (await SourceControlRepository.recentActions(db, "pratt", 10)).map(
        ({ action, detail, userId }) => ({ action, detail, userId }),
      ),
    ).toEqual([
      {
        action: "hide_source",
        detail: "Site redirects to spam",
        userId: "owner",
      },
      { action: "pause_ingestion", detail: null, userId: "owner" },
    ]);
  });

  test("keeps both of two overlapping changes to one source", async () => {
    const [hidden, paused] = await Promise.all([
      SourceControlRepository.apply(db, {
        source: "pratt",
        change: { kind: "hide", reason: "Hacked" },
        userId: "owner",
        now,
      }),
      SourceControlRepository.apply(db, {
        source: "pratt",
        change: { kind: "pause" },
        userId: "owner",
        now,
      }),
    ]);
    expect([hidden.status, paused.status]).toEqual(["changed", "changed"]);
    const pratt = await SourceControlRepository.forSource(db, "pratt");
    expect(pratt.ingestion).toBe("paused");
    expect(pratt.visibility).toEqual({ status: "hidden", reason: "Hacked" });
  });

  test("decides unchanged from the stored row, not an earlier read", async () => {
    const [first, second] = await Promise.all([
      SourceControlRepository.apply(db, {
        source: "pratt",
        change: { kind: "pause" },
        userId: "owner",
        now,
      }),
      SourceControlRepository.apply(db, {
        source: "pratt",
        change: { kind: "pause" },
        userId: "owner",
        now,
      }),
    ]);
    expect([first.status, second.status]).toEqual(["changed", "unchanged"]);
    expect(
      await SourceControlRepository.recentActions(db, "pratt", 10),
    ).toHaveLength(1);
  });

  test("resuming or showing a source without a row changes nothing", async () => {
    for (const change of [{ kind: "resume" }, { kind: "show" }] as const) {
      const applied = await SourceControlRepository.apply(db, {
        source: "pyp",
        change,
        userId: "owner",
        now,
      });
      expect(applied.status).toBe("unchanged");
    }
    expect(await SourceControlRepository.forSource(db, "pyp")).toEqual(
      SourceControl.initial("pyp"),
    );
    expect(
      await SourceControlRepository.recentActions(db, "pyp", 10),
    ).toHaveLength(0);
  });

  test("logs a manual run with its run ids", async () => {
    await SourceControlRepository.logRun(db, {
      source: "pyp",
      userId: "owner",
      runId: "run-1",
      workflowRunId: "wrun-1",
      now,
    });
    const [entry] = await SourceControlRepository.recentActions(db, "pyp", 5);
    expect(entry).toEqual({
      id: 1,
      action: "run_now",
      source: "pyp",
      userId: "owner",
      userName: null,
      detail: "Run run-1, workflow wrun-1",
      createdAt: now,
    });
  });

  test("names who made each change, by name, else email", async () => {
    await client.executeMultiple(`
      insert into user values ('owner', 'Sam Owner', 'sam@example.com');
      insert into user values ('helper', ' ', 'helper@example.com');
    `);
    for (const userId of ["owner", "helper", "gone"])
      await SourceControlRepository.logRun(db, {
        source: "pyp",
        userId,
        runId: `run-${userId}`,
        workflowRunId: "wrun",
        now,
      });
    expect(
      (await SourceControlRepository.recentActions(db, "pyp", 5)).map(
        ({ userId, userName }) => ({ userId, userName }),
      ),
    ).toEqual([
      { userId: "gone", userName: null },
      { userId: "helper", userName: "helper@example.com" },
      { userId: "owner", userName: "Sam Owner" },
    ]);
  });
});
