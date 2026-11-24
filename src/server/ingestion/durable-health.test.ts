import { describe, expect, test } from "bun:test";
import {
  isFreshPublication,
  sourcePublicationLookbackMs,
  sourceStaleAfterHours,
} from "./durable-health";

const now = new Date("2026-11-02T12:00:00.000Z");
const hoursAgo = (hours: number) => now.getTime() - hours * 60 * 60 * 1000;

describe("isFreshPublication", () => {
  test("keeps a daily source fresh for 36 hours after an accepted publication, the threshold every status check shares", () => {
    expect(sourceStaleAfterHours("pyp")).toBe(36);
    expect(isFreshPublication("pyp", hoursAgo(31), now)).toBe(true);
    expect(isFreshPublication("pyp", hoursAgo(36), now)).toBe(true);
    expect(isFreshPublication("pyp", hoursAgo(37), now)).toBe(false);
  });

  test("keeps a source crawled every third day fresh for its cadence plus 12 hours", () => {
    expect(sourceStaleAfterHours("upullrparts")).toBe(84);
    expect(isFreshPublication("upullrparts", hoursAgo(72), now)).toBe(true);
    expect(isFreshPublication("upullrparts", hoursAgo(84), now)).toBe(true);
    expect(isFreshPublication("upullrparts", hoursAgo(85), now)).toBe(false);
  });

  test("is stale without any accepted publication", () => {
    expect(isFreshPublication("pyp", null, now)).toBe(false);
    expect(isFreshPublication("upullrparts", null, now)).toBe(false);
  });
});

describe("sourcePublicationLookbackMs", () => {
  test("covers a missed scheduled crawl past the cadence: 3 days for a daily source, 5 for every third day", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(sourcePublicationLookbackMs("pyp")).toBe(3 * day);
    expect(sourcePublicationLookbackMs("upullrparts")).toBe(5 * day);
  });
});
