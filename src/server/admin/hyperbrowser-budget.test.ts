import { describe, expect, test } from "bun:test";
import {
  HYPERBROWSER_BURN_DAYS,
  HYPERBROWSER_SESSION_PAGE_CAP,
  HyperbrowserBudget,
  type HyperbrowserSnapshot,
} from "./hyperbrowser-budget";

const NOW = new Date("2026-11-22T12:00:00Z");
const CREDITS = { usage: 964, limit: 5000, remaining: 4036 };

function session(createdAt: string, creditsUsed: number | null) {
  // Hyperbrowser sends startTime as a string although its SDK types say number.
  return { id: createdAt, createdAt, startTime: "1795394413661", creditsUsed };
}

function fakeClient(pages: (page: number) => unknown) {
  const requested: { page: number; limit: number }[] = [];
  return {
    requested,
    client: {
      team: { getCreditInfo: async (): Promise<unknown> => CREDITS },
      sessions: {
        list: async (params: { page: number; limit: number }) => {
          requested.push(params);
          return pages(params.page);
        },
      },
    },
  };
}

describe("HyperbrowserBudget.read", () => {
  test("sums credits per UTC day for 14 days and stops at the first page past them", async () => {
    const { client, requested } = fakeClient((page) =>
      page === 1
        ? {
            totalCount: 500,
            sessions: [
              session("2026-11-22T10:00:00.000Z", 1.25),
              session("2026-11-22T09:00:00.000Z", null),
              session("2026-11-21T23:59:00.000Z", 0.5),
              // A full page, so the read goes on to page 2.
              ...Array.from({ length: 97 }, () =>
                session("2026-11-21T12:00:00.000Z", 0),
              ),
            ],
          }
        : {
            totalCount: 500,
            sessions: [
              session("2026-11-09T01:00:00.000Z", 2),
              session("2026-11-08T23:00:00.000Z", 100),
            ],
          },
    );
    const snapshot = await HyperbrowserBudget.read(client, NOW);
    expect(requested).toEqual([
      { page: 1, limit: 100 },
      { page: 2, limit: 100 },
    ]);
    expect(snapshot.credits).toEqual(CREDITS);
    expect(snapshot.coverage).toEqual({ kind: "complete" });
    expect(snapshot.daily).toHaveLength(HYPERBROWSER_BURN_DAYS);
    expect(snapshot.daily[0]).toEqual({ day: "2026-11-09", value: 2 });
    expect(snapshot.daily.at(-2)).toEqual({ day: "2026-11-21", value: 0.5 });
    expect(snapshot.daily.at(-1)).toEqual({ day: "2026-11-22", value: 1.25 });
    expect(snapshot.fetchedAt).toBe(NOW.getTime());
  });

  test("stops when the sessions run out", async () => {
    const { client, requested } = fakeClient(() => ({
      totalCount: 1,
      sessions: [session("2026-11-22T10:00:00.000Z", 1)],
    }));
    const snapshot = await HyperbrowserBudget.read(client, NOW);
    expect(requested).toHaveLength(1);
    expect(snapshot.coverage).toEqual({ kind: "complete" });
  });

  test("reads at most the page cap and says how far back it got", async () => {
    const { client, requested } = fakeClient((page) => ({
      totalCount: 100_000,
      sessions: Array.from({ length: 100 }, () =>
        session(
          page < 20 ? "2026-11-22T10:00:00.000Z" : "2026-11-20T10:00:00.000Z",
          0.01,
        ),
      ),
    }));
    const snapshot = await HyperbrowserBudget.read(client, NOW);
    expect(requested).toHaveLength(HYPERBROWSER_SESSION_PAGE_CAP);
    expect(snapshot.coverage).toEqual({
      kind: "partial",
      fromDay: "2026-11-20",
    });
  });

  test("stops and says so when sessions are not listed newest first", async () => {
    const { client, requested } = fakeClient((page) => ({
      totalCount: 100_000,
      sessions: Array.from({ length: 100 }, (_, index) =>
        session(
          page === 1
            ? "2026-11-22T10:00:00.000Z"
            : index === 0
              ? "2026-11-22T11:00:00.000Z"
              : "2026-11-21T10:00:00.000Z",
          1,
        ),
      ),
    }));
    const snapshot = await HyperbrowserBudget.read(client, NOW);
    expect(requested).toHaveLength(2);
    expect(snapshot.coverage).toEqual({ kind: "unordered" });
  });

  test("names the field when Hyperbrowser answers in an unexpected shape", async () => {
    const { client } = fakeClient(() => ({ sessions: [{ createdAt: 5 }] }));
    await expect(HyperbrowserBudget.read(client, NOW)).rejects.toThrow(
      /Hyperbrowser sessions\.list page 1 .*totalCount/s,
    );
  });
});

describe("HyperbrowserBudget.forecast", () => {
  function snapshot(
    dailyCredits: (day: string) => number,
    overrides: Partial<HyperbrowserSnapshot> = {},
  ): HyperbrowserSnapshot {
    return {
      credits: CREDITS,
      daily: [
        "2026-11-14",
        "2026-11-15",
        "2026-11-16",
        "2026-11-17",
        "2026-11-18",
        "2026-11-19",
        "2026-11-20",
        "2026-11-21",
        "2026-11-22",
      ].map((day) => ({ day, value: dailyCredits(day) })),
      coverage: { kind: "complete" },
      fetchedAt: NOW.getTime(),
      ...overrides,
    };
  }

  test("averages the 7 full days before the check and projects from it", () => {
    // 2026-11-15..21 average 100 a day; today's partial 500 is left out.
    const forecast = HyperbrowserBudget.forecast(
      snapshot((day) =>
        day === "2026-11-22" ? 500 : day === "2026-11-14" ? 9999 : 100,
      ),
    );
    expect(forecast).toEqual({
      kind: "measured",
      averagePerDay: 100,
      fullDays: 7,
      // 8.5 days left in November.
      projectedMonthEndUsage: 964 + 850,
      // 4036 credits at 100 a day: 40.36 days from noon on Nov 22.
      runsOut: { kind: "on", day: "2027-01-01", beforeMonthEnd: false },
    });
  });

  test("dates the forecast from when the snapshot was read", () => {
    // Read just before midnight: Nov 22 was still today, so not a full day.
    const forecast = HyperbrowserBudget.forecast(
      snapshot((day) => (day === "2026-11-22" ? 10 : 100), {
        fetchedAt: Date.parse("2026-11-22T23:55:00Z"),
      }),
    );
    expect(forecast).toMatchObject({ kind: "measured", averagePerDay: 100 });
  });

  test("says when credits run out before the month ends", () => {
    const forecast = HyperbrowserBudget.forecast(snapshot(() => 1000));
    expect(forecast).toMatchObject({
      kind: "measured",
      runsOut: { kind: "on", day: "2026-11-26", beforeMonthEnd: true },
    });
  });

  test("never runs out with no recent use", () => {
    const forecast = HyperbrowserBudget.forecast(snapshot(() => 0));
    expect(forecast).toEqual({
      kind: "measured",
      averagePerDay: 0,
      fullDays: 7,
      projectedMonthEndUsage: 964,
      runsOut: { kind: "never" },
    });
  });

  test("says the credits are used up, even after use has stopped", () => {
    const forecast = HyperbrowserBudget.forecast(
      snapshot(() => 0, {
        credits: { usage: 5000, limit: 5000, remaining: 0 },
      }),
    );
    expect(forecast).toEqual({ kind: "out" });
  });

  test("averages only the days after a partial read's oldest day", () => {
    // Nov 19 is the oldest day read, so it and the days before it are short.
    const forecast = HyperbrowserBudget.forecast(
      snapshot((day) => (day <= "2026-11-19" ? 1 : 100), {
        coverage: { kind: "partial", fromDay: "2026-11-19" },
      }),
    );
    expect(forecast).toMatchObject({
      kind: "measured",
      averagePerDay: 100,
      fullDays: 2,
    });
  });

  test("cannot measure a pace without a fully read day", () => {
    expect(
      HyperbrowserBudget.forecast(
        snapshot(() => 100, {
          coverage: { kind: "partial", fromDay: "2026-11-21" },
        }),
      ),
    ).toEqual({ kind: "unmeasured" });
    expect(
      HyperbrowserBudget.forecast(
        snapshot(() => 100, { coverage: { kind: "unordered" } }),
      ),
    ).toEqual({ kind: "unmeasured" });
  });
});
