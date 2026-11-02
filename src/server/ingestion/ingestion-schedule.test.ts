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
