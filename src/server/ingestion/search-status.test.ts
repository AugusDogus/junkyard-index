import { describe, expect, test } from "bun:test";
import { SearchStatus, type SearchStatusInputs } from "./search-status";

const NOW = new Date("2026-11-20T12:00:00Z");
const HOUR = 60 * 60 * 1000;

function inputs(overrides?: Partial<SearchStatusInputs>): SearchStatusInputs {
  return {
    mode: "decoupled",
    consumer: "enabled",
    environment: "production",
    generations: {
      status: "own",
      live: {
        id: "gen-1",
        environment: "production",
        indexName: "vehicles",
        reason: "bootstrap",
        requestedAt: new Date(NOW.getTime() - 24 * HOUR),
        status: "live",
        snapshotChangeId: 10,
        liveAt: new Date(NOW.getTime() - 20 * HOUR),
      },
      active: null,
    },
    checkpoint: {
      projectedThrough: 90,
      failureCount: 0,
      lastErrorTag: null,
      blockedUntil: null,
      lastSuccessAt: new Date(NOW.getTime() - HOUR),
    },
    horizon: 100,
    oldestUnprojectedAt: new Date(NOW.getTime() - HOUR),
    inlineWriterRunIds: [],
    ...overrides,
  };
}

describe("search status", () => {
  test("inline publication has nothing to report", () => {
    expect(SearchStatus.evaluate(inputs({ mode: "inline" }), NOW)).toEqual({
      status: "inline",
      mode: "inline",
    });
  });

  test("decoupled search within the lag threshold is healthy", () => {
    expect(SearchStatus.evaluate(inputs(), NOW)).toMatchObject({
      status: "healthy",
      lagChanges: 10,
      lagMs: HOUR,
      circuit: { state: "closed" },
      liveGeneration: { id: "gen-1", status: "live" },
      problems: [],
    });
  });

  test("lag past two hours, an open circuit or no live generation is unhealthy", () => {
    const lagging = SearchStatus.evaluate(
      inputs({ oldestUnprojectedAt: new Date(NOW.getTime() - 3 * HOUR) }),
      NOW,
    );
    expect(lagging.status).toBe("unhealthy");
    const blocked = SearchStatus.evaluate(
      inputs({
        checkpoint: {
          projectedThrough: 90,
          failureCount: 1,
          lastErrorTag: "SearchBackendBlocked",
          blockedUntil: new Date(NOW.getTime() + HOUR),
          lastSuccessAt: null,
        },
      }),
      NOW,
    );
    expect(blocked).toMatchObject({
      status: "unhealthy",
      circuit: { state: "open", lastErrorTag: "SearchBackendBlocked" },
    });
    const unbuilt = SearchStatus.evaluate(
      inputs({ generations: { status: "own", live: null, active: null } }),
      NOW,
    );
    expect(unbuilt.status).toBe("unhealthy");
    const unread = SearchStatus.evaluate(inputs({ mode: "unavailable" }), NOW);
    expect(unread).toMatchObject({ status: "unhealthy", mode: "unavailable" });
    expect(unread.status !== "inline" && unread.problems).toContainEqual(
      expect.stringContaining(
        "wait without writing (nothing is released or skipped)",
      ),
    );
  });

  test("a short transient backoff is not an outage", () => {
    const status = SearchStatus.evaluate(
      inputs({
        checkpoint: {
          projectedThrough: 90,
          failureCount: 1,
          lastErrorTag: "Transient",
          blockedUntil: new Date(NOW.getTime() + 60_000),
          lastSuccessAt: null,
        },
      }),
      NOW,
    );
    expect(status).toMatchObject({
      status: "healthy",
      circuit: { state: "open", lastErrorTag: "Transient" },
    });
  });

  test("a paused projector reports its lag without paging", () => {
    expect(
      SearchStatus.evaluate(
        inputs({
          consumer: "paused",
          oldestUnprojectedAt: new Date(NOW.getTime() - 5 * HOUR),
        }),
        NOW,
      ),
    ).toMatchObject({ status: "paused", lagMs: 5 * HOUR });
  });
});
