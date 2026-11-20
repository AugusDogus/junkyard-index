import { describe, expect, test } from "bun:test";
import { isFreshPublication, SOURCE_STALE_AFTER_HOURS } from "./durable-health";

const now = new Date("2026-11-02T12:00:00.000Z");
const hoursAgo = (hours: number) => now.getTime() - hours * 60 * 60 * 1000;

describe("isFreshPublication", () => {
  test("stays fresh for 36 hours after an accepted publication, the threshold every status check shares", () => {
    expect(SOURCE_STALE_AFTER_HOURS).toBe(36);
    expect(isFreshPublication(hoursAgo(31), now)).toBe(true);
    expect(isFreshPublication(hoursAgo(36), now)).toBe(true);
    expect(isFreshPublication(hoursAgo(37), now)).toBe(false);
  });

  test("is stale without any accepted publication", () => {
    expect(isFreshPublication(null, now)).toBe(false);
  });
});
