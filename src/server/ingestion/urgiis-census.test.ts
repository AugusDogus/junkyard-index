import { expect, test } from "bun:test";
import { URGIIS_DAY_MS as DAY, urgiisSweepDue } from "./urgiis-census";

/** Replays the sweep rule over daily runs. Every model is read in a cold census
 * on day 0; each later run reads only the models the rule marks due. */
function simulate(
  models: number,
  days: number,
  startOffset: (day: number) => number,
) {
  const first = Date.UTC(2026, 10, 20, 7);
  const readAt = Array.from({ length: models }, () => first + startOffset(0));
  const reads: number[][] = Array.from({ length: models }, () => [0]);
  for (let day = 1; day <= days; day++) {
    const now = first + day * DAY + startOffset(day);
    readAt.forEach((at, index) => {
      if (!urgiisSweepDue(index, now, at)) return;
      readAt[index] = now;
      reads[index]?.push(day);
    });
  }
  return reads;
}

test.each([
  ["identical start times", () => 0],
  ["starts drifting later", (day: number) => day * 1_000],
  ["starts drifting earlier", (day: number) => -day * 1_000],
  ["sub-second jitter", (day: number) => (day % 2 ? -889 : 889)],
])(
  "the weekly sweep reads each model once per six-day window (%s)",
  (_name, startOffset) => {
    const reads = simulate(42, 120, startOffset);
    for (const days of reads) {
      const gaps = days.slice(1).map((day, i) => day - (days[i] ?? 0));
      // The first incremental days realign bootstrap reads onto slices.
      expect(gaps.slice(2).every((gap) => gap === 6)).toBe(true);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(6);
    }
    const steady = reads.flat().filter((day) => day > 30 && day <= 120);
    expect(steady.length).toBe((42 * 90) / 6);
  },
);
