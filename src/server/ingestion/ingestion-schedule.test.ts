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
    expect(due(failed(IngestionSchedule.maxAttemptsPerDay, 10))).toEqual([]);
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
          day("pullnsave", false, IngestionSchedule.maxAttemptsPerDay),
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
            attempts: IngestionSchedule.maxAttemptsPerDay,
            lastStartedAt: hoursAgo(1.9),
            lastCompletedAt: null,
            validationRejected: false,
          },
        ],
        enabledSources: ["row52", "pyp", "pullnsave", "ipullupull"],
        now,
      }),
    ).toBe(hoursAgo(1.5) + IngestionSchedule.retryDelayMs);
    expect(
      IngestionSchedule.nextRetryAt({
        days: [],
        enabledSources: ["row52"],
        now,
      }),
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
  expect(IngestionSchedule.nextRetryAt({ ...params, now })).toBeNull();
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
  expect(IngestionSchedule.nextRetryAt({ ...params, now })).toBe(
    hoursAgo(0.25) + IngestionSchedule.retryDelayMs,
  );
});

describe("AutoRecycler's daily start", () => {
  // Ario imports the Ez Pull N Pay and Foss yards at 08:30 to 08:52 UTC
  // (Nov 5 to 25, 2026). A 07:00 crawl published those arrivals a day late.
  const at = (time: string) => new Date(`2026-11-25T${time}:00.000Z`);

  test("waits for Ario's morning import while other sources start at the day boundary", () => {
    const params = {
      days: [],
      enabledSources: ["row52", "autorecycler"] as const,
    };
    expect(
      IngestionSchedule.dueSources({ ...params, now: at("07:00") }),
    ).toEqual(["row52"]);
    expect(
      IngestionSchedule.nextRetryAt({
        days: [],
        enabledSources: ["autorecycler"],
        now: at("07:00"),
      }),
    ).toBe(at("09:15").getTime());
    expect(
      IngestionSchedule.dueSources({ ...params, now: at("09:15") }),
    ).toEqual(["row52", "autorecycler"]);
    expect(IngestionSchedule.passComplete(params)).toBe(false);
  });

  test("a failure from the previous day retries no earlier than the start", () => {
    const params = {
      days: [
        {
          source: "autorecycler",
          published: false,
          attempts: 0,
          lastStartedAt: null,
          lastCompletedAt: at("06:30").getTime(),
          validationRejected: false,
        },
      ],
      enabledSources: ["autorecycler"] as const,
    };
    expect(
      IngestionSchedule.dueSources({ ...params, now: at("08:45") }),
    ).toEqual([]);
    expect(IngestionSchedule.nextRetryAt({ ...params, now: at("08:45") })).toBe(
      at("09:15").getTime(),
    );
  });
});
