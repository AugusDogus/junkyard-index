import { expect, test } from "bun:test";
import {
  RivervalleyCursor,
  RivervalleyCursorSchema,
  type RivervalleySeen,
} from "./rivervalley-cursor";

const checkpoint: Extract<RivervalleyCursor, { phase: "pages" }> = {
  source: "rivervalley",
  phase: "pages",
  nextPage: 2,
  total: 26,
  processed: 25,
  emitted: 25,
  rejected: 0,
  duplicates: 0,
  hashes: ["a".repeat(64)],
  seen: Array.from(
    { length: 25 },
    (_, index): RivervalleySeen => ({
      id: String(index + 1),
      status: "available",
      vin: "4DRBUAAN0EB" + String(485230 - index),
      identity: "b".repeat(64),
    }),
  ),
};
test("River Valley cursors serialize complete donor and page evidence", () => {
  expect(RivervalleyCursorSchema.parse(RivervalleyCursor.initial)).toEqual(
    RivervalleyCursor.initial,
  );
  expect(
    RivervalleyCursorSchema.parse(JSON.parse(JSON.stringify(checkpoint))),
  ).toEqual(checkpoint);
});
test.each([
  { processed: 24 },
  { emitted: 24 },
  { rejected: 1 },
  { duplicates: 1 },
  { hashes: [] },
  { nextPage: 3 },
  { total: 25 },
  { seen: [] },
  { seen: [...checkpoint.seen.slice(1), checkpoint.seen[1]] },
  {
    seen: checkpoint.seen.map((row) => ({ ...row, vin: "4DRBUAAN0EB485230" })),
  },
])("River Valley rejects impossible checkpoints before requests", (patch) => {
  expect(
    RivervalleyCursorSchema.safeParse({ ...checkpoint, ...patch }).success,
  ).toBe(false);
});
