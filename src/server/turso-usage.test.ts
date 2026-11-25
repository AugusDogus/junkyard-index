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

describe("TursoUsage.check", () => {
  const now = new Date("2026-11-16T00:00:00Z");

  test("without credentials it says which are missing and reads nothing", async () => {
    const { fetch, calls } = fakeFetch(200, orgUsage(0, 0));
    expect(
      await TursoUsage.check(
        { token: undefined, organization: "x" },
        now,
        fetch,
      ),
    ).toEqual({ kind: "unconfigured", missing: ["TURSO_PLATFORM_API_TOKEN"] });
    expect(calls).toEqual([]);
  });

  test("a failed read is unavailable, not on pace", async () => {
    const { fetch } = fakeFetch(500, {});
    const check = await TursoUsage.check(ACCESS, now, fetch);
    expect(check.kind).toBe("unavailable");
  });

  test("a read is measured against the plan", async () => {
    const { fetch } = fakeFetch(200, orgUsage(1_100_000_000, 1_000));
    const check = await TursoUsage.check(ACCESS, now, fetch);
    expect(check.kind === "measured" && check.status).toBe("over_pace");
  });
});

describe("TursoUsage.alert", () => {
  const now = new Date("2026-11-16T00:00:00Z");

  test("on pace raises nothing", () => {
    const check = {
      kind: "measured" as const,
      ...TursoUsage.pace({ rowsRead: 1, rowsWritten: 1 }, now),
    };
    expect(TursoUsage.alert(check)).toBeNull();
  });

  test("over pace warns with the projection", () => {
    const check = {
      kind: "measured" as const,
      ...TursoUsage.pace({ rowsRead: 1_100_000_000, rowsWritten: 0 }, now),
    };
    const alert = TursoUsage.alert(check);
    expect(alert?.level).toBe("warning");
    expect(alert?.message).toContain("2.20B of 2.50B rows read");
  });

  test("over quota is an error", () => {
    const check = {
      kind: "measured" as const,
      ...TursoUsage.pace({ rowsRead: 0, rowsWritten: 26_000_000 }, now),
    };
    expect(TursoUsage.alert(check)?.level).toBe("error");
  });

  test("an unconfigured guard warns, since nothing is watching the bill", () => {
    expect(
      TursoUsage.alert({
        kind: "unconfigured",
        missing: ["TURSO_ORGANIZATION"],
      })?.level,
    ).toBe("warning");
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
