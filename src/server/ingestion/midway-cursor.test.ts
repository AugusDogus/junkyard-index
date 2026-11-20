import { expect, test } from "bun:test";
import { MidwayCursor, MidwayCursorSchema } from "./midway-cursor";

test("Midway permits start, validated next-yard opening and terminal checkpoints", () => {
  for (const cursor of [
    MidwayCursor.initial,
    {
      source: "midway",
      phase: "opening",
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

const census = {
  source: "midway",
  phase: "census",
  yardCode: "OO95",
  observedVins: ["1C3CCCAB6GN125544"],
  stocks: ["2604445"],
  makes: ["FORD", "LAND ROVER"],
  witness: ["a".repeat(64)],
  openingHash: "b".repeat(64),
  openingRows: 400,
  processed: 10,
  rejected: 1,
} as const;
test("Midway permits a mid-yard make traversal checkpoint for every yard", () => {
  expect(MidwayCursorSchema.safeParse(census).success).toBe(true);
  expect(
    MidwayCursorSchema.safeParse({ ...census, makes: [], witness: [] }).success,
  ).toBe(true);
  // Muncie's traversal may checkpoint before its first donor is admitted.
  expect(
    MidwayCursorSchema.safeParse({
      ...census,
      yardCode: "MO38",
      observedVins: [],
      stocks: [],
    }).success,
  ).toBe(true);
});
test.each([
  { ...census, observedVins: [] },
  { ...census, yardCode: "MO09", observedVins: [] },
  { ...census, yardCode: "ANY" },
  { ...census, makes: ["FORD", "FORD"] },
  { ...census, makes: ["ford"] },
  { ...census, witness: ["a".repeat(64), "a".repeat(64)] },
  { ...census, witness: ["a".repeat(64), "c".repeat(64)], openingRows: 1 },
  { ...census, openingHash: "not-a-hash" },
  { ...census, openingRows: 0 },
  { ...census, openingRows: 501 },
  { ...census, rejected: 11 },
])(
  "Midway rejects an inconsistent make traversal checkpoint (%#)",
  (cursor) => {
    expect(MidwayCursorSchema.safeParse(cursor).success).toBe(false);
  },
);

// Checkpoints saved before every yard became a make traversal. A "yard"
// cursor past Muncie implies Muncie (and maybe Liberty) was admitted from a
// truncated broad table, so none of these may resume; the run fails and the
// next run starts fresh.
test.each([
  {
    source: "midway",
    phase: "yard",
    yardCode: "MO38",
    observedVins: [],
    stocks: [],
  },
  {
    source: "midway",
    phase: "yard",
    yardCode: "MO09",
    observedVins: ["1C3CCCAB6GN125544"],
    stocks: [],
  },
  {
    source: "midway",
    phase: "yard",
    yardCode: "OO95",
    observedVins: ["1C3CCCAB6GN125544"],
    stocks: [],
  },
  {
    source: "midway",
    phase: "tulsa",
    observedVins: ["1C3CCCAB6GN125544"],
    stocks: ["2604445"],
    makes: ["FORD"],
    witness: ["a".repeat(64)],
    openingHash: "b".repeat(64),
    processed: 10,
    rejected: 1,
  },
])("Midway refuses a pre-census checkpoint shape (%#)", (cursor) => {
  expect(MidwayCursorSchema.safeParse(cursor).success).toBe(false);
});
