import { describe, expect, test } from "bun:test";
import {
  DURABLE_INITIAL_SOURCE_CURSORS,
  DURABLE_SOURCE_DEFINITIONS,
  durableSourceCursorEquals,
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-source";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";

describe("durable ingestion cursors", () => {
  test.each(["ipullupull", "partsgalore"] as const)(
    "round trips %s atomic catalog checkpoints",
    (source) => {
      for (const catalog of [0, 1] as const) {
        const cursor = { source, catalog };
        expect(
          parseDurableSourceCursor(
            source,
            serializeDurableSourceCursor(cursor),
          ),
        ).toEqual(cursor);
      }
      expect(() => parseDurableSourceCursor(source, "2")).toThrow();
      expect(() => parseDurableSourceCursor(source, "-1")).toThrow();
    },
  );

  test("round trips Washington's resumable yard page evidence", () => {
    const cursor = {
      source: "upullitwa" as const,
      phase: "page" as const,
      yardId: "UU44",
      page: 2,
      declaredPageCount: 3,
      completedYardIds: ["JJ65", "UU43"],
      pageFingerprints: ["a".repeat(64)],
      usableYardVehicles: 422,
    };
    expect(
      parseDurableSourceCursor(
        "upullitwa",
        serializeDurableSourceCursor(cursor),
      ),
    ).toEqual(cursor);
    expect(() =>
      parseDurableSourceCursor("upullitwa", '{"phase":"page"}'),
    ).toThrow();
  });
  test("registers every canonical ingestion source exactly once", () => {
    expect(Object.keys(DURABLE_SOURCE_DEFINITIONS)).toEqual([
      ...INGESTION_SOURCES,
    ]);
    expect(
      DURABLE_INITIAL_SOURCE_CURSORS.map((cursor) => cursor.source),
    ).toEqual([...INGESTION_SOURCES]);
  });

  test("bounds Row52 checkpoints to one 1,000-vehicle page", () => {
    expect(DURABLE_SOURCE_DEFINITIONS.row52.maxPagesPerChunk).toBe(1);
  });

  test("amortizes PYP browser startup across thirty pages", () => {
    expect(DURABLE_SOURCE_DEFINITIONS.pyp.maxPagesPerChunk).toBe(30);
  });

  test("starts PYP at the first store and preserves store and page checkpoints", () => {
    expect(DURABLE_SOURCE_DEFINITIONS.pyp.initialCursor).toEqual({
      source: "pyp",
      storeCodes: null,
      storeIndex: 0,
      page: 0,
    });
    const cursor = {
      source: "pyp" as const,
      storeCodes: Array.from({ length: 20 }, (_, index) =>
        String(1200 + index),
      ),
      storeIndex: 1,
      page: 2,
    };
    expect(
      parseDurableSourceCursor("pyp", serializeDurableSourceCursor(cursor)),
    ).toEqual(cursor);
    expect(() =>
      parseDurableSourceCursor(
        "pyp",
        JSON.stringify({ storeCodes: null, storeIndex: 1, page: 0 }),
      ),
    ).toThrow("Invalid pyp ingestion cursor");
    expect(() =>
      parseDurableSourceCursor(
        "pyp",
        JSON.stringify({
          storeCodes: [...cursor.storeCodes].reverse(),
          storeIndex: 1,
          page: 0,
        }),
      ),
    ).toThrow("Invalid pyp ingestion cursor");
  });

  test("parses old PYP page cursors for in-flight global crawls", () => {
    expect(parseDurableSourceCursor("pyp", "0")).toEqual({
      source: "pyp",
      page: 0,
    });
  });

  test("amortizes Pull-A-Part setup across ten make pages", () => {
    expect(DURABLE_SOURCE_DEFINITIONS.pullapart.maxPagesPerChunk).toBe(10);
  });

  test("parses valid integer and pair cursors", () => {
    expect(
      parseDurableSourceCursor("wrenchapart", '{"afterLocationId":4}'),
    ).toEqual({ source: "wrenchapart", afterLocationId: 4 });
    expect(
      serializeDurableSourceCursor({
        source: "wrenchapart",
        afterLocationId: 4,
      }),
    ).toBe('{"afterLocationId":4}');
    expect(parseDurableSourceCursor("upullrparts", "0")).toEqual({
      source: "upullrparts",
      catalog: 0,
    });
    expect(parseDurableSourceCursor("upullrparts", "1")).toEqual({
      source: "upullrparts",
      catalog: 1,
    });
    expect(
      serializeDurableSourceCursor({ source: "upullrparts", catalog: 1 }),
    ).toBe("1");
    expect(parseDurableSourceCursor("pullnsave", "11")).toEqual({
      source: "pullnsave",
      page: 11,
    });
    expect(parseDurableSourceCursor("tearapart", "1")).toEqual({
      source: "tearapart",
      storeIndex: 1,
    });
    expect(
      serializeDurableSourceCursor({ source: "pullnsave", page: 11 }),
    ).toBe("11");
    expect(
      serializeDurableSourceCursor({ source: "tearapart", storeIndex: 1 }),
    ).toBe("1");
    expect(parseDurableSourceCursor("pyp", "12")).toEqual({
      source: "pyp",
      page: 12,
    });
    expect(parseDurableSourceCursor("pullapart", "3:7")).toEqual({
      source: "pullapart",
      locationId: 3,
      makeId: 7,
    });
  });

  test("rejects malformed cursors instead of restarting a source", () => {
    expect(() =>
      parseDurableSourceCursor("wrenchapart", '{"afterLocationId":-1}'),
    ).toThrow("Invalid wrenchapart ingestion cursor");
    expect(() => parseDurableSourceCursor("upullrparts", "2")).toThrow(
      "Invalid upullrparts ingestion cursor",
    );
    expect(() => parseDurableSourceCursor("pullnsave", "0")).toThrow(
      "Invalid pullnsave ingestion cursor",
    );
    expect(() => parseDurableSourceCursor("tearapart", "-1")).toThrow(
      "Invalid tearapart ingestion cursor",
    );
    expect(() => parseDurableSourceCursor("pyp", "12x")).toThrow(
      "Invalid pyp ingestion cursor: 12x",
    );
    expect(() => parseDurableSourceCursor("pullapart", "3")).toThrow(
      "Invalid pullapart ingestion cursor: 3",
    );
  });

  test("round trips a Row52 cursor with its active yard group", () => {
    const cursor = {
      source: "row52" as const,
      afterLocationId: 19,
      locationIds: [20, 21, 22],
      skip: 1000,
    };
    const serialized = serializeDurableSourceCursor(cursor);
    expect(serialized).toBe(
      '{"afterLocationId":19,"locationIds":[20,21,22],"skip":1000}',
    );
    expect(parseDurableSourceCursor("row52", serialized)).toEqual(cursor);
    expect(DURABLE_SOURCE_DEFINITIONS.row52.initialCursor).toEqual({
      source: "row52",
      afterLocationId: 0,
      locationIds: [],
      skip: 0,
    });
  });

  test("round trips the Davie catalog metadata needed across chunks", () => {
    const cursor = {
      source: "upullitdavie" as const,
      page: 25,
      totalPages: 61,
      totalCount: 1_460,
      pageSize: 24,
      recordsProcessed: 576,
      recordsRejected: 0,
    };
    const serialized = serializeDurableSourceCursor(cursor);
    expect(serialized).toBe(
      '{"page":25,"totalPages":61,"totalCount":1460,"pageSize":24,"recordsProcessed":576,"recordsRejected":0}',
    );
    expect(parseDurableSourceCursor("upullitdavie", serialized)).toEqual(
      cursor,
    );
    expect(
      durableSourceCursorEquals(cursor, {
        ...cursor,
        recordsRejected: 1,
      }),
    ).toBe(false);
  });

  test("round trips GO Pull-It catalog validation counters", () => {
    const cursor = {
      source: "gopullit" as const,
      page: 25,
      recordsProcessed: 240,
      recordsSkipped: 30,
    };
    const serialized = serializeDurableSourceCursor(cursor);
    expect(serialized).toBe(
      '{"page":25,"recordsProcessed":240,"recordsSkipped":30}',
    );
    expect(parseDurableSourceCursor("gopullit", serialized)).toEqual(cursor);
  });
});
