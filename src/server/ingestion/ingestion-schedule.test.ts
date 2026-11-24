import { describe, expect, test } from "bun:test";
import { IngestionSchedule } from "./ingestion-schedule";

const now = new Date("2026-11-02T12:00:00.000Z");
const hoursAgo = (hours: number) => now.getTime() - hours * 60 * 60 * 1000;

describe("IngestionSchedule.dueSources", () => {
  test("starts every enabled source that has not run today", () => {
    expect(
      IngestionSchedule.dueSources({
        days: [],
        enabledSources: ["row52", "pyp", "pullnsave"],
        now,
      }),
    ).toEqual(["row52", "pyp", "pullnsave"]);
  });

  test("skips published and disabled sources", () => {
    expect(
      IngestionSchedule.dueSources({
        days: [
          {
            source: "row52",
            published: true,
            attempts: 1,
            lastStartedAt: hoursAgo(5),
            lastCompletedAt: null,
            validationRejected: false,
          },
        ],
        enabledSources: ["row52", "pyp"],
        now,
      }),
    ).toEqual(["pyp"]);
  });

  test("retries a failed source after the delay and stops at the daily limit", () => {
    const failed = (attempts: number, hours: number) => ({
      source: "pullnsave",
      published: false,
      attempts,
      lastStartedAt: hoursAgo(hours),
      lastCompletedAt: null,
      validationRejected: false,
    });
    const due = (day: ReturnType<typeof failed>) =>
      IngestionSchedule.dueSources({
        days: [day],
        enabledSources: ["pullnsave"],
        now,
      });

    expect(due(failed(1, 1))).toEqual([]);
    expect(due(failed(1, 2))).toEqual(["pullnsave"]);
    expect(IngestionSchedule.maxAttemptsPerDay("pullnsave")).toBe(3);
    expect(due(failed(2, 10))).toEqual(["pullnsave"]);
    expect(due(failed(3, 10))).toEqual([]);
  });

  test("starts U Pull R Parts once a day, since every failing chunk retry opens a headful Kernel browser", () => {
    expect(IngestionSchedule.maxAttemptsPerDay("upullrparts")).toBe(1);
    const failed = {
      source: "upullrparts",
      published: false,
      attempts: 1,
      lastStartedAt: hoursAgo(10),
      lastCompletedAt: null,
      validationRejected: false,
    };
    expect(
      IngestionSchedule.dueSources({
        days: [failed],
        enabledSources: ["upullrparts"],
        now,
      }),
    ).toEqual([]);
    expect(
      IngestionSchedule.passComplete({
        days: [failed],
        enabledSources: ["upullrparts"],
      }),
    ).toBe(true);
    expect(
      IngestionSchedule.nextRetryAt({
        days: [failed],
        enabledSources: ["upullrparts"],
      }),
    ).toBeNull();
  });
});

describe("IngestionSchedule.passComplete", () => {
  const day = (source: string, published: boolean, attempts: number) => ({
    source,
    published,
    attempts,
    lastStartedAt: hoursAgo(1),
    lastCompletedAt: null,
    validationRejected: false,
  });

  test("stays open while any enabled source can still run today", () => {
    expect(
      IngestionSchedule.passComplete({
        days: [day("row52", true, 1), day("pullnsave", false, 1)],
        enabledSources: ["row52", "pullnsave"],
      }),
    ).toBe(false);
    expect(
      IngestionSchedule.passComplete({
        days: [day("row52", true, 1)],
        enabledSources: ["row52", "pyp"],
      }),
    ).toBe(false);
  });

  test("closes once every enabled source published or used its attempts", () => {
    expect(
      IngestionSchedule.passComplete({
        days: [
          day("row52", true, 1),
          day(
            "pullnsave",
            false,
            IngestionSchedule.maxAttemptsPerDay("pullnsave"),
          ),
        ],
        enabledSources: ["row52", "pullnsave"],
      }),
    ).toBe(true);
  });
});

describe("IngestionSchedule.nextRetryAt", () => {
  test("returns the earliest retry of a source that can still run today", () => {
    expect(
      IngestionSchedule.nextRetryAt({
        days: [
          {
            source: "row52",
            published: true,
            attempts: 1,
            lastStartedAt: hoursAgo(1),
            lastCompletedAt: null,
            validationRejected: false,
          },
          {
            source: "pyp",
            published: false,
            attempts: 1,
            lastStartedAt: hoursAgo(1),
            lastCompletedAt: null,
            validationRejected: false,
          },
          {
            source: "pullnsave",
            published: false,
            attempts: 1,
            lastStartedAt: hoursAgo(1.5),
            lastCompletedAt: null,
            validationRejected: false,
          },
          {
            source: "ipullupull",
            published: false,
            attempts: IngestionSchedule.maxAttemptsPerDay("ipullupull"),
            lastStartedAt: hoursAgo(1.9),
            lastCompletedAt: null,
            validationRejected: false,
          },
        ],
        enabledSources: ["row52", "pyp", "pullnsave", "ipullupull"],
      }),
    ).toBe(hoursAgo(1.5) + IngestionSchedule.retryDelayMs);
    expect(
      IngestionSchedule.nextRetryAt({ days: [], enabledSources: ["row52"] }),
    ).toBeNull();
  });
});

test("validation rejection ends automatic attempts for the day", () => {
  const days = [
    {
      source: "pyp",
      published: false,
      attempts: 1,
      lastStartedAt: hoursAgo(5),
      lastCompletedAt: hoursAgo(4),
      validationRejected: true,
    },
  ];
  const params = { days, enabledSources: ["pyp"] as const };
  expect(IngestionSchedule.dueSources({ ...params, now })).toEqual([]);
  expect(IngestionSchedule.nextRetryAt(params)).toBeNull();
  expect(IngestionSchedule.passComplete(params)).toBe(true);
});

test("a long transient failure waits two hours after completion", () => {
  const params = {
    days: [
      {
        source: "pyp",
        published: false,
        attempts: 1,
        lastStartedAt: hoursAgo(5),
        lastCompletedAt: hoursAgo(0.25),
        validationRejected: false,
      },
    ],
    enabledSources: ["pyp"] as const,
  };
  expect(IngestionSchedule.dueSources({ ...params, now })).toEqual([]);
  expect(IngestionSchedule.nextRetryAt(params)).toBe(
    hoursAgo(0.25) + IngestionSchedule.retryDelayMs,
  );
});

describe("IngestionSchedule.scheduledSources", () => {
  // `now` is 2026-11-02T12:00Z, ingestion day 2026-11-02.
  const accepted = (source: string, day: string) =>
    new Map([[source, { lastAttemptDay: day, lastAcceptedDay: day }]]);
  const failed = (
    source: string,
    day: string,
    lastAcceptedDay: string | null = null,
  ) => new Map([[source, { lastAttemptDay: day, lastAcceptedDay }]]);

  test("keeps a daily source every day, after an accepted or a failed day", () => {
    for (const crawlDays of [
      accepted("pyp", "2026-11-01"),
      failed("pyp", "2026-11-01"),
    ])
      expect(
        IngestionSchedule.scheduledSources({
          enabledSources: ["pyp"],
          crawlDays,
          now,
        }),
      ).toEqual(["pyp"]);
  });

  test("rests a source crawled every third day until three ingestion days after its last accepted run's day", () => {
    const scheduled = (day: string) =>
      IngestionSchedule.scheduledSources({
        enabledSources: ["upullrparts", "pyp"],
        crawlDays: accepted("upullrparts", day),
        now,
      });

    expect(scheduled("2026-11-01")).toEqual(["pyp"]);
    expect(scheduled("2026-10-31")).toEqual(["pyp"]);
    expect(scheduled("2026-10-30")).toEqual(["upullrparts", "pyp"]);
  });

  test("rests a source crawled every third day for one day after a failed crawl day, then retries", () => {
    const scheduled = (crawlDays: ReturnType<typeof failed>) =>
      IngestionSchedule.scheduledSources({
        enabledSources: ["upullrparts"],
        crawlDays,
        now,
      });

    expect(scheduled(failed("upullrparts", "2026-11-01"))).toEqual([]);
    expect(
      scheduled(failed("upullrparts", "2026-11-01", "2026-10-28")),
    ).toEqual([]);
    expect(scheduled(failed("upullrparts", "2026-10-31"))).toEqual([
      "upullrparts",
    ]);
  });

  test("keeps a source with no run in the look-back", () => {
    expect(
      IngestionSchedule.scheduledSources({
        enabledSources: ["upullrparts"],
        crawlDays: new Map(),
        now,
      }),
    ).toEqual(["upullrparts"]);
  });

  test("keeps a source that already ran today, so dueSources counts its attempts", () => {
    for (const crawlDays of [
      accepted("upullrparts", "2026-11-02"),
      failed("upullrparts", "2026-11-02"),
    ])
      expect(
        IngestionSchedule.scheduledSources({
          enabledSources: ["upullrparts"],
          crawlDays,
          now,
        }),
      ).toEqual(["upullrparts"]);
  });
});

describe("IngestionSchedule.restingUntil", () => {
  test("names the day a resting source is next crawled, and null when it is scheduled", () => {
    const rest = (lastAttemptDay: string, lastAcceptedDay: string | null) =>
      IngestionSchedule.restingUntil(
        "upullrparts",
        { lastAttemptDay, lastAcceptedDay },
        now,
      );
    expect(rest("2026-11-01", "2026-11-01")).toBe("2026-11-04");
    expect(rest("2026-10-31", "2026-10-31")).toBe("2026-11-03");
    expect(rest("2026-11-01", null)).toBe("2026-11-03");
    expect(rest("2026-10-30", "2026-10-30")).toBeNull();
    expect(
      IngestionSchedule.restingUntil(
        "pyp",
        { lastAttemptDay: "2026-11-01", lastAcceptedDay: "2026-11-01" },
        now,
      ),
    ).toBeNull();
  });
});
