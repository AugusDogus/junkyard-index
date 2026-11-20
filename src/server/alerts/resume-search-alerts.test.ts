import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import {
  parseResumeSearchAlertsArgs,
  resumeSearchAlerts,
} from "./resume-search-alerts";

const RELAUNCH = new Date("2026-11-21T18:00:00.000Z");
const NOW = new Date("2026-11-21T18:05:00.000Z");

const SCHEMA = `
  create table saved_search (
    id text primary key,
    email_alerts_enabled integer not null default 0,
    discord_alerts_enabled integer not null default 0,
    last_checked_at integer,
    updated_at integer not null default 0
  );
  create table search_notification_intent (
    id text primary key, saved_search_id text not null,
    channel text not null default 'email',
    status text not null default 'pending', claim_token text,
    created_at integer not null default 0, cancelled_at integer,
    last_error text
  );
  insert into saved_search (id, email_alerts_enabled, discord_alerts_enabled, last_checked_at) values
    ('stale-email', 1, 0, ${Date.parse("2026-11-18T15:54:40Z")}),
    ('stale-discord', 0, 1, ${Date.parse("2026-11-18T15:54:40Z")}),
    ('never-checked', 1, 1, null),
    ('enabled-later', 1, 0, ${RELAUNCH.getTime() + 60_000}),
    ('alerts-off', 0, 0, ${Date.parse("2026-11-01T00:00:00Z")});
`;

async function windows(client: ReturnType<typeof createClient>) {
  const rows = await client.execute(
    "select id, last_checked_at from saved_search order by id",
  );
  return rows.rows.map((row) => [row.id, row.last_checked_at]);
}

const STALE_WINDOWS = [
  ["alerts-off", Date.parse("2026-11-01T00:00:00Z")],
  ["enabled-later", RELAUNCH.getTime() + 60_000],
  ["never-checked", null],
  ["stale-discord", Date.parse("2026-11-18T15:54:40Z")],
  ["stale-email", Date.parse("2026-11-18T15:54:40Z")],
];

const RESUMED_WINDOWS = [
  ["alerts-off", Date.parse("2026-11-01T00:00:00Z")],
  ["enabled-later", RELAUNCH.getTime() + 60_000],
  ["never-checked", RELAUNCH.getTime()],
  ["stale-discord", RELAUNCH.getTime()],
  ["stale-email", RELAUNCH.getTime()],
];

describe("resumeSearchAlerts", () => {
  test("starts every alert-enabled window at the relaunch without moving any back", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(SCHEMA);
      expect(
        await resumeSearchAlerts(client, RELAUNCH, {
          cancelPending: false,
          now: NOW,
        }),
      ).toEqual({
        status: "resumed",
        advanced: 3,
        alreadyLater: 1,
        cancelledIntents: 0,
      });
      expect(await windows(client)).toEqual(RESUMED_WINDOWS);
      // Rerunning changes nothing.
      expect(
        await resumeSearchAlerts(client, RELAUNCH, {
          cancelPending: false,
          now: NOW,
        }),
      ).toEqual({
        status: "resumed",
        advanced: 0,
        alreadyLater: 4,
        cancelledIntents: 0,
      });
    } finally {
      client.close();
    }
  });

  test("refuses while a notification could still go out, and changes nothing", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(`${SCHEMA}
        insert into search_notification_intent (id, saved_search_id, status, created_at) values
          ('backlog', 'stale-email', 'pending', 2),
          ('retrying', 'stale-discord', 'retry', 1),
          ('sent', 'stale-email', 'delivered', 0),
          ('dropped', 'stale-email', 'cancelled', 0);
      `);
      expect(
        await resumeSearchAlerts(client, RELAUNCH, {
          cancelPending: false,
          now: NOW,
        }),
      ).toEqual({
        status: "pending_intents",
        intents: [
          {
            id: "retrying",
            savedSearchId: "stale-discord",
            channel: "email",
            status: "retry",
            createdAt: 1,
          },
          {
            id: "backlog",
            savedSearchId: "stale-email",
            channel: "email",
            status: "pending",
            createdAt: 2,
          },
        ],
      });
      expect(await windows(client)).toEqual(STALE_WINDOWS);
      expect(
        (
          await client.execute(
            "select count(*) as n from search_notification_intent where status = 'cancelled'",
          )
        ).rows[0]?.n,
      ).toBe(1);
    } finally {
      client.close();
    }
  });

  test("--cancel-pending cancels pending notifications and advances windows in one transaction", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(`${SCHEMA}
        insert into search_notification_intent (id, saved_search_id, status, claim_token) values
          ('backlog', 'stale-email', 'pending', null),
          ('in-flight', 'stale-email', 'sending', 'claim'),
          ('sent', 'stale-email', 'delivered', null);
      `);
      expect(
        await resumeSearchAlerts(client, RELAUNCH, {
          cancelPending: true,
          now: NOW,
        }),
      ).toEqual({
        status: "resumed",
        advanced: 3,
        alreadyLater: 1,
        cancelledIntents: 2,
      });
      expect(await windows(client)).toEqual(RESUMED_WINDOWS);
      const intents = await client.execute(
        "select id, status, claim_token, cancelled_at from search_notification_intent order by id",
      );
      expect(
        intents.rows.map((row) => [
          row.id,
          row.status,
          row.claim_token,
          row.cancelled_at,
        ]),
      ).toEqual([
        ["backlog", "cancelled", null, NOW.getTime()],
        ["in-flight", "cancelled", null, NOW.getTime()],
        ["sent", "delivered", null, null],
      ]);
    } finally {
      client.close();
    }
  });
});

describe("parseResumeSearchAlertsArgs", () => {
  const full = [
    "--db-url",
    "file:local.db",
    "--relaunch-at",
    RELAUNCH.toISOString(),
    "--confirm",
  ];

  test("accepts an explicit database, a past relaunch time and --confirm", () => {
    expect(parseResumeSearchAlertsArgs(full, NOW)).toEqual({
      status: "ok",
      databaseUrl: "file:local.db",
      relaunchAt: RELAUNCH,
      cancelPending: false,
    });
    expect(
      parseResumeSearchAlertsArgs([...full, "--cancel-pending"], NOW),
    ).toMatchObject({ status: "ok", cancelPending: true });
    expect(
      parseResumeSearchAlertsArgs(
        [
          "--db-url",
          "file:local.db",
          "--relaunch-at",
          "2026-11-21T12:00:00-06:00",
          "--confirm",
        ],
        NOW,
      ),
    ).toMatchObject({ status: "ok", relaunchAt: RELAUNCH });
  });

  test.each([
    [
      "without --confirm",
      full.filter((arg) => arg !== "--confirm"),
      "--confirm",
    ],
    ["without --db-url", full.slice(2), "--db-url"],
    [
      "without --relaunch-at",
      [...full.slice(0, 2), "--confirm"],
      "--relaunch-at",
    ],
    [
      "with a time that has no zone",
      [
        "--db-url",
        "file:local.db",
        "--relaunch-at",
        "2026-11-21T18:00:00",
        "--confirm",
      ],
      "no time zone",
    ],
    [
      "with an unreadable time",
      ["--db-url", "file:local.db", "--relaunch-at", "tomorrowZ", "--confirm"],
      "not a valid time",
    ],
    [
      "with a future time",
      [
        "--db-url",
        "file:local.db",
        "--relaunch-at",
        "2026-11-21T19:00:00Z",
        "--confirm",
      ],
      "in the future",
    ],
    ["with an unknown argument", [...full, "--force"], "Unknown argument"],
  ])("refuses to run %s", (_name, argv, message) => {
    const result = parseResumeSearchAlertsArgs(argv, NOW);
    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" ? result.message : "").toContain(
      message,
    );
  });
});
