import { expect, test } from "bun:test";
import { TritownCursorSchema } from "./tritown-cursor";

test("TriTown rejects checkpoints that skip unprocessed pages or fake their accounting", () => {
  const cursor = {
    source: "tritown",
    phase: "pages",
    nextPage: 2,
    lastPage: 3,
    processed: 5,
    emitted: 5,
    rejected: 0,
    makes: ["Chevrolet"],
    vins: Array.from(
      { length: 5 },
      (_, i) => "2CNALBEW8A" + String(i + 1).padStart(7, "0"),
    ),
    urls: Array.from(
      { length: 5 },
      (_, i) => "https://tritownautosalvage.com/vehicle/test-" + i + "/",
    ),
    hashes: ["a".repeat(64)],
  };
  expect(TritownCursorSchema.safeParse(cursor).success).toBe(true);
  for (const altered of [
    { ...cursor, nextPage: 3 },
    { ...cursor, rejected: 1 },
    { ...cursor, urls: [] },
    { ...cursor, vins: ["INVALID"] },
  ])
    expect(TritownCursorSchema.safeParse(altered).success).toBe(false);
});
