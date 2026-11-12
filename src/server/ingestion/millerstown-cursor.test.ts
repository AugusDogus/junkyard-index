import { expect, test } from "bun:test";
import {
  MillerstownCursor,
  MillerstownCursorSchema,
} from "./millerstown-cursor";
import {
  durableSourceCursorEquals,
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";

test("both atomic phases round-trip through the actual durable codec", () => {
  for (const phase of ["start", "complete"] as const) {
    const cursor = MillerstownCursorSchema.parse({
      source: "millerstown",
      phase,
    });
    const serialized = serializeDurableSourceCursor(cursor);
    expect(JSON.parse(serialized)).toEqual({ phase });
    expect(parseDurableSourceCursor("millerstown", serialized)).toEqual(cursor);
    expect(
      durableSourceCursorEquals(
        cursor,
        parseDurableSourceCursor("millerstown", serialized),
      ),
    ).toBe(true);
  }
});
for (const cursor of [
  null,
  {},
  { source: "millerstown", phase: "pages" },
  { source: "pipes", phase: "start" },
  { ...MillerstownCursor.initial, offset: 1 },
  { ...MillerstownCursor.initial, pdf: "bytes" },
])
  test(`rejects non-atomic checkpoint ${JSON.stringify(cursor)}`, () => {
    expect(MillerstownCursorSchema.safeParse(cursor).success).toBe(false);
  });
test("shared durable codec rejects unknown persisted payload fields", () => {
  expect(() =>
    parseDurableSourceCursor("millerstown", '{"phase":"start","offset":1}'),
  ).toThrow();
});
