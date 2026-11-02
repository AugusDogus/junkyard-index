import { describe, expect, test } from "bun:test";
import {
  assessIngestionFreshness,
  classifyDurableIngestionHealth,
} from "./durable-health";

const now = new Date("2026-11-02T12:00:00.000Z");
const hoursAgo = (hours: number) => now.getTime() - hours * 60 * 60 * 1000;

describe("durable ingestion health", () => {
  test("degrades for one failed run or stale source instead of going down", () => {
    expect(
      classifyDurableIngestionHealth({
        runFailed: true,
        attempted: ["row52", "pyp"],
        stale: [],
      }),
    ).toBe("degraded");
    expect(
      classifyDurableIngestionHealth({
        runFailed: false,
        attempted: ["row52", "pyp"],
        stale: ["pyp"],
      }),
    ).toBe("degraded");
    expect(
      classifyDurableIngestionHealth({
        runFailed: false,
        attempted: ["row52", "pyp"],
        stale: [],
      }),
    ).toBe("healthy");
  });

  test("is down when every attempted source is stale", () => {
    expect(
      classifyDurableIngestionHealth({
        runFailed: false,
        attempted: ["row52", "pyp"],
        stale: ["row52", "pyp"],
      }),
    ).toBe("down");
  });

  test("flags only attempted sources without a recent accepted publication", () => {
    expect(
      assessIngestionFreshness(
        [
          {
            source: "row52",
            lastAttemptAt: hoursAgo(1),
            lastPublishedAt: hoursAgo(1),
          },
          {
            source: "pullnsave",
            lastAttemptAt: hoursAgo(1),
            lastPublishedAt: hoursAgo(20),
          },
          {
            source: "ipullupull",
            lastAttemptAt: hoursAgo(2),
            lastPublishedAt: hoursAgo(31),
          },
          {
            source: "upullrparts",
            lastAttemptAt: hoursAgo(2),
            lastPublishedAt: null,
          },
          {
            source: "disabled",
            lastAttemptAt: hoursAgo(30),
            lastPublishedAt: hoursAgo(40),
          },
        ],
        now,
      ),
    ).toEqual({
      attempted: ["row52", "pullnsave", "ipullupull", "upullrparts"],
      stale: ["ipullupull", "upullrparts"],
    });
  });
});
