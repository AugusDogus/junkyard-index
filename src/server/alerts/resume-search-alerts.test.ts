import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import {
  parseResumeSearchAlertsArgs,
  resumeSearchAlerts,
} from "./resume-search-alerts";

const RELAUNCH = new Date("2026-11-21T18:00:00.000Z");
const NOW = new Date("2026-11-21T18:05:00.000Z");

describe("resumeSearchAlerts", () => {
  test("starts every alert-enabled window at the relaunch without moving any back", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(`
        create table saved_search (
          id text primary key,
          email_alerts_enabled integer not null default 0,
          discord_alerts_enabled integer not null default 0,
          last_checked_at integer,
          updated_at integer not null default 0
        );
        insert into saved_search (id, email_alerts_enabled, discord_alerts_enabled, last_checked_at) values
          ('stale-email', 1, 0, ${Date.parse("2026-11-18T15:54:40Z")}),
          ('stale-discord', 0, 1, ${Date.parse("2026-11-18T15:54:40Z")}),
          ('never-checked', 1, 1, null),
          ('enabled-later', 1, 0, ${RELAUNCH.getTime() + 60_000}),
          ('alerts-off', 0, 0, ${Date.parse("2026-11-01T00:00:00Z")});
      `);
      expect(await resumeSearchAlerts(client, RELAUNCH)).toEqual({
        advanced: 3,
        alreadyLater: 1,
      });
      const rows = await client.execute(
        "select id, last_checked_at from saved_search order by id",
      );
      expect(rows.rows.map((row) => [row.id, row.last_checked_at])).toEqual([
        ["alerts-off", Date.parse("2026-11-01T00:00:00Z")],
        ["enabled-later", RELAUNCH.getTime() + 60_000],
        ["never-checked", RELAUNCH.getTime()],
        ["stale-discord", RELAUNCH.getTime()],
        ["stale-email", RELAUNCH.getTime()],
      ]);
      // Rerunning changes nothing.
      expect(await resumeSearchAlerts(client, RELAUNCH)).toEqual({
        advanced: 0,
        alreadyLater: 4,
      });
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
    });
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
      "with an unreadable time",
      ["--db-url", "file:local.db", "--relaunch-at", "tomorrow", "--confirm"],
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
