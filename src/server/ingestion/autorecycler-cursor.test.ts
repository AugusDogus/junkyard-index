import { describe, expect, test } from "bun:test";
import { AutorecyclerCursor } from "./autorecycler-cursor";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-source";

describe("AutoRecycler record-ID checkpoints", () => {
  test.each([
    AutorecyclerCursor.initial,
    { source: "autorecycler", phase: "page", beforeId: "1700000000000x100" },
    { source: "autorecycler", phase: "complete" },
  ] satisfies AutorecyclerCursor[])("round trips %j", (cursor) => {
    expect(
      parseDurableSourceCursor(
        "autorecycler",
        serializeDurableSourceCursor(cursor),
      ),
    ).toEqual(cursor);
  });

  test.each(["0", "49600", "50000", "50400"])(
    "rejects a legacy offset %s instead of accepting or resuming a partial feed",
    (cursor) => {
      expect(() => parseDurableSourceCursor("autorecycler", cursor)).toThrow(
        "Start a new ingestion run; previously published inventory is preserved",
      );
    },
  );

  test.each([
    '{"phase":"page","beforeId":""}',
    '{"phase":"page","beforeId":"invalid"}',
    '{"phase":"page"}',
    '{"phase":"complete","beforeId":"1700000000000x100"}',
    '{"from":50000}',
  ])("rejects malformed checkpoint %s", (cursor) => {
    expect(() => parseDurableSourceCursor("autorecycler", cursor)).toThrow();
  });
});
