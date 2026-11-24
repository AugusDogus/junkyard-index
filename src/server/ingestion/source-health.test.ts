import { describe, expect, test } from "bun:test";
import {
  ACTIVE_INGESTION_SOURCES,
  RETIRED_INGESTION_SOURCES,
} from "~/lib/ingestion-source";
import type { IngestionSourceFreshness } from "./durable-health";
import { SourceHealth } from "./source-health";

const now = new Date("2026-11-19T12:00:00.000Z");
const hoursAgo = (hours: number) => now.getTime() - hours * 60 * 60 * 1000;
const published = (
  source: string,
  lastPublishedAt: number | null,
): IngestionSourceFreshness => ({
  source,
  lastAttemptAt: hoursAgo(1),
  lastPublishedAt,
});
const allFresh = ACTIVE_INGESTION_SOURCES.map((source) =>
  published(source, hoursAgo(2)),
);

describe("SourceHealth.evaluate", () => {
  test("is healthy when every enabled source published within 36 hours", () => {
    const recent = allFresh.map((row) =>
      row.source === "pyp" ? published("pyp", hoursAgo(36)) : row,
    );
    expect(
      SourceHealth.evaluate(recent, ACTIVE_INGESTION_SOURCES, now),
    ).toEqual({
      status: "healthy",
      staleAfterHours: 36,
      checked: ACTIVE_INGESTION_SOURCES.length,
      outageAfterStale: Math.ceil(ACTIVE_INGESTION_SOURCES.length * 0.2),
      paused: [],
      stale: [],
    });
  });

  test("is stale once a fifth of the checked sources are stale", () => {
    const outageAfterStale = Math.ceil(ACTIVE_INGESTION_SOURCES.length * 0.2);
    const staleSources = ACTIVE_INGESTION_SOURCES.slice(0, outageAfterStale);
    const recent = allFresh.map((row) =>
      staleSources.some((source) => source === row.source)
        ? published(row.source, hoursAgo(40))
        : row,
    );
    const justBelow = allFresh.map((row) =>
      staleSources.slice(1).some((source) => source === row.source)
        ? published(row.source, hoursAgo(40))
        : row,
    );

    const outage = SourceHealth.evaluate(recent, ACTIVE_INGESTION_SOURCES, now);
    const degraded = SourceHealth.evaluate(
      justBelow,
      ACTIVE_INGESTION_SOURCES,
      now,
    );

    expect(outage.status).toBe("stale");
    expect(outage.stale).toHaveLength(outageAfterStale);
    expect(degraded.status).toBe("degraded");
    expect(degraded.stale).toHaveLength(outageAfterStale - 1);
  });

  test("lists each stale source with its last accepted publication", () => {
    const recent = [
      ...allFresh.filter(
        (row) => row.source !== "pyp" && row.source !== "aero",
      ),
      published("pyp", hoursAgo(37)),
      published("aero", null),
    ];
    // "row52" has no run in the lookback at all.
    const withoutRow52 = recent.filter((row) => row.source !== "row52");

    const health = SourceHealth.evaluate(
      withoutRow52,
      ACTIVE_INGESTION_SOURCES,
      now,
    );

    expect(health.status).toBe("degraded");
    expect(health.stale).toEqual([
      {
        source: "row52",
        name: "Row52",
        lastPublishedAt: null,
        staleAfterHours: 36,
      },
      {
        source: "pyp",
        name: "LKQ Pick Your Part",
        lastPublishedAt: new Date(hoursAgo(37)),
        staleAfterHours: 36,
      },
      {
        source: "aero",
        name: "Aero Auto Parts",
        lastPublishedAt: null,
        staleAfterHours: 36,
      },
    ]);
  });

  test("allows a source crawled every third day its cadence plus 12 hours", () => {
    const withUpullRParts = (hours: number) =>
      SourceHealth.evaluate(
        allFresh.map((row) =>
          row.source === "upullrparts"
            ? published("upullrparts", hoursAgo(hours))
            : row,
        ),
        ACTIVE_INGESTION_SOURCES,
        now,
      );

    expect(withUpullRParts(84).status).toBe("healthy");
    expect(withUpullRParts(85).stale).toEqual([
      {
        source: "upullrparts",
        name: "U Pull R Parts",
        lastPublishedAt: new Date(hoursAgo(85)),
        staleAfterHours: 84,
      },
    ]);
  });

  test("leaves paused sources out of the check and names them", () => {
    const enabled = ACTIVE_INGESTION_SOURCES.filter(
      (source) => source !== "aero",
    );
    const recent = allFresh.filter((row) => row.source !== "aero");

    const health = SourceHealth.evaluate(recent, enabled, now);

    expect(health.status).toBe("healthy");
    expect(health.checked).toBe(ACTIVE_INGESTION_SOURCES.length - 1);
    expect(health.paused).toEqual(["aero"]);
    expect(health.stale).toEqual([]);
  });

  test("never checks retired sources", () => {
    const health = SourceHealth.evaluate(
      allFresh,
      RETIRED_INGESTION_SOURCES,
      now,
    );

    expect(health).toEqual({
      status: "healthy",
      staleAfterHours: 36,
      checked: 0,
      outageAfterStale: 1,
      paused: [...ACTIVE_INGESTION_SOURCES],
      stale: [],
    });
  });
});
