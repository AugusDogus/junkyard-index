import { describe, expect, test } from "bun:test";
import { INVENTORY_HIDDEN_AFTER_DAYS } from "~/lib/inventory-staleness";
import {
  isFreshPublication,
  SOURCE_FRESHNESS_LOOKBACK_DAYS,
  SOURCE_STALE_AFTER_HOURS,
} from "./durable-health";

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

test("reads far enough back that a source missing from it has not published within the hide window", () => {
  // A cold URG census can run three days before it publishes.
  expect(SOURCE_FRESHNESS_LOOKBACK_DAYS).toBeGreaterThanOrEqual(
    INVENTORY_HIDDEN_AFTER_DAYS + 3,
  );
});
