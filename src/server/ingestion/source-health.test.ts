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
      paused: [],
      stale: [],
    });
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

    expect(health.status).toBe("stale");
    expect(health.stale).toEqual([
      {
        source: "row52",
        name: "Row52",
        lastPublishedAt: null,
      },
      {
        source: "pyp",
        name: "LKQ Pick Your Part",
        lastPublishedAt: new Date(hoursAgo(37)),
      },
      {
        source: "aero",
        name: "Aero Auto Parts",
        lastPublishedAt: null,
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
      paused: [...ACTIVE_INGESTION_SOURCES],
      stale: [],
    });
  });
});
