import { describe, expect, test } from "bun:test";
import {
  DURABLE_INITIAL_SOURCE_CURSORS,
  DURABLE_SOURCE_DEFINITIONS,
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-source";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";

describe("durable ingestion cursors", () => {
  test("registers every canonical ingestion source exactly once", () => {
    expect(Object.keys(DURABLE_SOURCE_DEFINITIONS)).toEqual([
      ...INGESTION_SOURCES,
    ]);
    expect(
      DURABLE_INITIAL_SOURCE_CURSORS.map((cursor) => cursor.source),
    ).toEqual([...INGESTION_SOURCES]);
  });

  test("parses valid integer and pair cursors", () => {
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
    expect(
      parseDurableSourceCursor("row52", serializeDurableSourceCursor(cursor)),
    ).toEqual(cursor);
    expect(DURABLE_SOURCE_DEFINITIONS.row52.initialCursor).toEqual({
      source: "row52",
      afterLocationId: 0,
      locationIds: [],
      skip: 0,
    });
  });
});
