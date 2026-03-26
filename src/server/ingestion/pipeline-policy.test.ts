import { describe, expect, test } from "bun:test";
import {
  determineHealthySources,
  shouldAdvanceMissingState,
  type PipelineSourceOutcome,
} from "./pipeline-policy";

describe("pipeline policy", () => {
  test("returns all sources as healthy when all have no errors", () => {
    const outcomes: PipelineSourceOutcome[] = [
      { source: "row52", count: 120000, errors: [] },
      { source: "pyp", count: 70000, errors: [] },
      { source: "autorecycler", count: 5000, errors: [] },
    ];

    expect(determineHealthySources(outcomes)).toEqual([
      "row52",
      "pyp",
      "autorecycler",
    ]);
    expect(shouldAdvanceMissingState(outcomes)).toBe(true);
  });

  test("keeps healthy sources but blocks missing-state advance when one source errors", () => {
    const outcomes: PipelineSourceOutcome[] = [
      { source: "row52", count: 130000, errors: [] },
      {
        source: "pyp",
        count: 0,
        errors: ["PYP returned only 0 locations (expected 20+)"],
      },
      { source: "autorecycler", count: 100, errors: [] },
    ];

    expect(determineHealthySources(outcomes)).toEqual(["row52", "autorecycler"]);
    expect(shouldAdvanceMissingState(outcomes)).toBe(false);
  });

  test("returns no healthy sources when all sources error", () => {
    const outcomes: PipelineSourceOutcome[] = [
      { source: "row52", count: 0, errors: ["Row52 failed"] },
      { source: "pyp", count: 0, errors: ["PYP failed"] },
      { source: "autorecycler", count: 0, errors: ["AutoRecycler failed"] },
    ];

    expect(determineHealthySources(outcomes)).toEqual([]);
    expect(shouldAdvanceMissingState(outcomes)).toBe(false);
  });
});
