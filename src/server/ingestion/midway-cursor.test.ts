import { expect, test } from "bun:test";
import { MidwayCursor, MidwayCursorSchema } from "./midway-cursor";

test("Midway permits start, validated second-yard and terminal checkpoints", () => {
  for (const cursor of [
    MidwayCursor.initial,
    {
      source: "midway",
      phase: "yard",
      yardCode: "MO09",
      observedVins: ["1C3CCCAB6GN125544"],
      stocks: [],
    },
    { source: "midway", phase: "complete" },
  ])
    expect(MidwayCursorSchema.safeParse(cursor).success).toBe(true);
});
test.each([
  { ...MidwayCursor.initial, yardCode: "ANY" },
  { ...MidwayCursor.initial, yardCode: "MO09" },
  { ...MidwayCursor.initial, observedVins: ["1C3CCCAB6GN125544"] },
  {
    ...MidwayCursor.initial,
    yardCode: "MO09",
    observedVins: ["1C3CCCAB6GN125544", "1C3CCCAB6GN125544"],
  },
  { ...MidwayCursor.initial, yardCode: "MO09", observedVins: ["BAD"] },
  { ...MidwayCursor.initial, unverifiedScope: true },
])("Midway rejects inconsistent or unowned cursor scope (%#)", (cursor) => {
  expect(MidwayCursorSchema.safeParse(cursor).success).toBe(false);
});
