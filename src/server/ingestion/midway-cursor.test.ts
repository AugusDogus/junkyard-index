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

const tulsa = {
  source: "midway",
  phase: "tulsa",
  observedVins: ["1C3CCCAB6GN125544"],
  stocks: ["2604445"],
  makes: ["FORD", "LAND ROVER"],
  witness: ["a".repeat(64)],
  openingHash: "b".repeat(64),
  processed: 10,
  rejected: 1,
} as const;
test("Midway permits a mid-Tulsa make traversal checkpoint", () => {
  expect(MidwayCursorSchema.safeParse(tulsa).success).toBe(true);
  expect(
    MidwayCursorSchema.safeParse({ ...tulsa, makes: [], witness: [] }).success,
  ).toBe(true);
});
test.each([
  { ...tulsa, observedVins: [] },
  { ...tulsa, makes: ["FORD", "FORD"] },
  { ...tulsa, makes: ["ford"] },
  { ...tulsa, witness: ["a".repeat(64), "a".repeat(64)] },
  { ...tulsa, openingHash: "not-a-hash" },
  { ...tulsa, rejected: 11 },
  { ...tulsa, yardCode: "OO95" },
])("Midway rejects an inconsistent Tulsa checkpoint (%#)", (cursor) => {
  expect(MidwayCursorSchema.safeParse(cursor).success).toBe(false);
});
