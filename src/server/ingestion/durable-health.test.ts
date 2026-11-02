import { describe, expect, test } from "bun:test";
import { isFreshPublication } from "./durable-health";

const now = new Date("2026-11-02T12:00:00.000Z");
const hoursAgo = (hours: number) => now.getTime() - hours * 60 * 60 * 1000;

describe("isFreshPublication", () => {
  test("stays fresh for 30 hours after an accepted publication", () => {
    expect(isFreshPublication(hoursAgo(29), now)).toBe(true);
    expect(isFreshPublication(hoursAgo(30), now)).toBe(true);
    expect(isFreshPublication(hoursAgo(31), now)).toBe(false);
  });

  test("is stale without any accepted publication", () => {
    expect(isFreshPublication(null, now)).toBe(false);
  });
});
