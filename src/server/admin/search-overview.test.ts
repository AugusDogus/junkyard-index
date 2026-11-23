import { describe, expect, test } from "bun:test";
import type { SearchStatus } from "~/server/ingestion/search-status";
import { SearchOverview } from "./search-overview";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-11-22T15:00:00Z");
const inline: SearchStatus = { status: "inline", mode: "inline" };
const nothingWaiting = { count: 0, capped: false, oldestCreatedAt: null };

function decoupled(
  status: "healthy" | "unhealthy",
  problems: string[] = [],
): SearchStatus {
  return {
    status,
    mode: "decoupled",
    projectedThrough: 90,
    horizon: 100,
    lagChanges: 10,
    lagMs: 5 * 60_000,
    circuit: {
      state: "closed",
      lastErrorTag: null,
      failureCount: 0,
      retryAt: null,
    },
    liveGeneration: null,
    activeGeneration: null,
    lastSuccessAt: null,
    inlineWriterRunIds: [],
    problems,
  };
}

const base = {
  now,
  projector: "enabled" as const,
  newestSearchPublishedAt: now,
  unprocessed: nothingWaiting,
  fullReindexRequired: false,
};

describe("SearchOverview.build", () => {
  test("inline search with nothing waiting has no problems", () => {
    expect(SearchOverview.build({ ...base, status: inline })).toMatchObject({
      backlog: { kind: "inline", count: 0, capped: false },
      problems: [],
    });
  });

  test("inline changes waiting over 2 hours are a problem", () => {
    const oldestCreatedAt = new Date(now.getTime() - 3 * HOUR);
    expect(
      SearchOverview.build({
        ...base,
        status: inline,
        unprocessed: { count: 10_000, capped: true, oldestCreatedAt },
      }).problems,
    ).toEqual([
      "10000+ vehicle changes have waited for search since 2026-11-22T12:00:00.000Z, over the 120 minute threshold.",
    ]);
  });

  test("inline changes from a run publishing now are not a problem yet", () => {
    expect(
      SearchOverview.build({
        ...base,
        status: inline,
        unprocessed: {
          count: 50,
          capped: false,
          oldestCreatedAt: new Date(now.getTime() - HOUR),
        },
      }).problems,
    ).toEqual([]);
  });

  test("decoupled search reports the projector's lag and its problems", () => {
    expect(
      SearchOverview.build({
        ...base,
        status: decoupled("unhealthy", ["The circuit is open."]),
      }),
    ).toMatchObject({
      backlog: { kind: "decoupled", count: 10, lagMs: 5 * 60_000 },
      problems: ["The circuit is open."],
    });
    expect(
      SearchOverview.build({ ...base, status: decoupled("healthy") }).problems,
    ).toEqual([]);
  });

  test("an owed full rebuild is a problem", () => {
    expect(
      SearchOverview.build({
        ...base,
        status: inline,
        fullReindexRequired: true,
      }).problems,
    ).toHaveLength(1);
  });
});
