import { describe, expect, test } from "bun:test";
import { TURSO_DEVELOPER_PLAN, TursoUsage } from "./turso-usage";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; authorization: string | null }[] = [];
  return {
    calls,
    fetch: async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, authorization: init.headers.Authorization ?? null });
      return new Response(JSON.stringify(body), { status });
    },
  };
}

const ACCESS = { token: "test-platform-token", organization: "example-org" };

function orgUsage(rowsRead: number, rowsWritten: number) {
  return {
    organization: {
      usage: { rows_read: rowsRead, rows_written: rowsWritten },
    },
  };
}

describe("TursoUsage.read", () => {
  test("reads the organization's billing-month totals", async () => {
    const { fetch, calls } = fakeFetch(200, orgUsage(1_000, 20));
    expect(await TursoUsage.read(ACCESS, fetch)).toEqual({
      rowsRead: 1_000,
      rowsWritten: 20,
    });
    expect(calls).toEqual([
      {
        url: "https://api.turso.tech/v1/organizations/example-org/usage",
        authorization: "Bearer test-platform-token",
      },
    ]);
  });

  test("a refused read names the status without the token", async () => {
    const { fetch } = fakeFetch(401, { error: "unauthorized" });
    const read = TursoUsage.read(ACCESS, fetch);
    await expect(read).rejects.toThrow("HTTP 401");
    await expect(read).rejects.not.toThrow("test-platform-token");
  });

  test("an unexpected shape is an error, not zero usage", async () => {
    const { fetch } = fakeFetch(200, { organization: {} });
    await expect(TursoUsage.read(ACCESS, fetch)).rejects.toThrow(
      "organization.usage",
    );
  });
});

/** Answers the organization and database usage reads by URL. */
function usageFetch(month: [number, number], day: [number, number]) {
  const urls: string[] = [];
  return {
    urls,
    fetch: async (url: string) => {
      urls.push(url);
      const body = url.includes("/databases/")
        ? { total: { rows_read: day[0], rows_written: day[1] } }
        : orgUsage(...month);
      return new Response(JSON.stringify(body), { status: 200 });
    },
  };
}

const PRODUCTION = { ...ACCESS, database: "example-db" };

describe("TursoUsage.check", () => {
  const now = new Date("2026-11-16T00:00:00Z");

  test("without credentials it says which are missing and reads nothing", async () => {
    const { fetch, calls } = fakeFetch(200, orgUsage(0, 0));
    expect(
      await TursoUsage.check(
        { token: undefined, organization: "x", database: "y" },
        now,
        fetch,
      ),
    ).toEqual({ kind: "unconfigured", missing: ["TURSO_PLATFORM_API_TOKEN"] });
    expect(calls).toEqual([]);
  });

  test("a failed read is unavailable, not on pace", async () => {
    const { fetch } = fakeFetch(500, {});
    const check = await TursoUsage.check(PRODUCTION, now, fetch);
    expect(check.kind).toBe("unavailable");
  });

  test("paces the month and reads the database's last 24 hours", async () => {
    const { fetch, urls } = usageFetch(
      [1_100_000_000, 1_000],
      [40_000_000, 3_000_000],
    );
    const check = await TursoUsage.check(PRODUCTION, now, fetch);
    if (check.kind !== "measured")
      throw new Error(`Expected measured, got ${check.kind}`);
    expect(check.status).toBe("over_pace");
    expect(check.lastDay).toEqual({
      rowsRead: 40_000_000,
      rowsWritten: 3_000_000,
      spiking: ["rowsWritten"],
    });
    expect(urls).toContain(
      "https://api.turso.tech/v1/organizations/example-org/databases/example-db/usage?from=2026-11-15T00%3A00%3A00.000Z&to=2026-11-16T00%3A00%3A00.000Z",
    );
  });
});

describe("TursoUsage.databaseName", () => {
  test("reads the database from a Turso host in the organization", () => {
    expect(
      TursoUsage.databaseName(
        "libsql://junkyardindex-example-org.aws-us-east-1.turso.io",
        "example-org",
      ),
    ).toBe("junkyardindex");
  });

  test("is null for a host in another organization or no URL", () => {
    expect(
      TursoUsage.databaseName("libsql://db-other.turso.io", "example-org"),
    ).toBeNull();
    expect(TursoUsage.databaseName("file:local.db", "example-org")).toBeNull();
  });
});

describe("TursoUsage.alerts", () => {
  const now = new Date("2026-11-16T00:00:00Z");
  const quiet = TursoUsage.lastDay({
    rowsRead: 40_000_000,
    rowsWritten: 300_000,
  });
  const measured = (
    month: { rowsRead: number; rowsWritten: number },
    lastDay = quiet,
  ) => ({ kind: "measured" as const, ...TursoUsage.pace(month, now), lastDay });

  test("on pace with a quiet day raises nothing", () => {
    expect(
      TursoUsage.alerts(measured({ rowsRead: 1, rowsWritten: 1 }), {
        pace: true,
      }),
    ).toEqual([]);
  });

  test("over pace warns with the projection, once a day", () => {
    const check = measured({ rowsRead: 1_100_000_000, rowsWritten: 0 });
    const [alert] = TursoUsage.alerts(check, { pace: true });
    expect(alert?.kind).toBe("pace");
    expect(alert?.level).toBe("warning");
    expect(alert?.message).toContain("2.20B of 2.50B rows read");
    expect(TursoUsage.alerts(check, { pace: false })).toEqual([]);
  });

  test("over quota is an error", () => {
    const [alert] = TursoUsage.alerts(
      measured({ rowsRead: 0, rowsWritten: 26_000_000 }),
      { pace: true },
    );
    expect(alert?.level).toBe("error");
  });

  test("a spike in the last 24 hours warns every hour it is seen", () => {
    const check = measured(
      { rowsRead: 1, rowsWritten: 1 },
      TursoUsage.lastDay({ rowsRead: 320_000_000, rowsWritten: 100_000 }),
    );
    const alerts = TursoUsage.alerts(check, { pace: false });
    expect(alerts.map((alert) => alert.kind)).toEqual(["spike"]);
    expect(alerts[0]?.message).toContain("0.32B rows read");
  });

  test("an unconfigured guard warns once a day, since nothing is watching the bill", () => {
    const check = {
      kind: "unconfigured" as const,
      missing: ["TURSO_ORGANIZATION"],
    };
    expect(TursoUsage.alerts(check, { pace: true })[0]?.level).toBe("warning");
    expect(TursoUsage.alerts(check, { pace: false })).toEqual([]);
  });
});

describe("TursoUsage.pace", () => {
  // Halfway through a 30-day month.
  const mid = new Date("2026-11-16T00:00:00Z");

  test("half the headroom by mid-month is on pace", () => {
    const report = TursoUsage.pace(
      { rowsRead: 900_000_000, rowsWritten: 5_000_000 },
      mid,
    );
    expect(report.status).toBe("on_pace");
    expect(report.meters.rowsRead.projected).toBe(1_800_000_000);
    expect(report.meters.rowsWritten.projected).toBe(10_000_000);
  });

  test("projecting past 80% of the quota is over pace", () => {
    // 1.1B by mid-month projects 2.2B, 88% of 2.5B.
    const report = TursoUsage.pace(
      { rowsRead: 1_100_000_000, rowsWritten: 0 },
      mid,
    );
    expect(report.status).toBe("over_pace");
    expect(report.meters.rowsRead.status).toBe("over_pace");
    expect(report.meters.rowsWritten.status).toBe("on_pace");
  });

  test("usage past the quota is over quota, whatever the pace", () => {
    const report = TursoUsage.pace(
      { rowsRead: 0, rowsWritten: TURSO_DEVELOPER_PLAN.rowsWritten + 1 },
      new Date("2026-11-30T23:00:00Z"),
    );
    expect(report.status).toBe("over_quota");
    expect(report.meters.rowsWritten.status).toBe("over_quota");
  });

  test("the first hours of a month project from at least a day", () => {
    // 60M reads in the first hour is one heavy day, not 1.4B a day.
    const report = TursoUsage.pace(
      { rowsRead: 60_000_000, rowsWritten: 0 },
      new Date("2026-12-01T01:00:00Z"),
    );
    expect(report.meters.rowsRead.projected).toBe(60_000_000 * 31);
    expect(report.status).toBe("on_pace");
  });
});

describe("TursoUsage.readDatabase", () => {
  test("reads totals nested under database, as Turso's reference shows", async () => {
    const { fetch } = fakeFetch(200, {
      database: { uuid: "x", total: { rows_read: 7, rows_written: 3 } },
    });
    expect(
      await TursoUsage.readDatabase(
        PRODUCTION,
        new Date("2026-11-15T00:00:00Z"),
        new Date("2026-11-16T00:00:00Z"),
        fetch,
      ),
    ).toEqual({ rowsRead: 7, rowsWritten: 3 });
  });
});
