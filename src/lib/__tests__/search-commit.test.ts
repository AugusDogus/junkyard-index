import { describe, expect, test } from "bun:test";
import {
  executeSearchCommit,
  resolveCommittedSearchSync,
  resolveSearchCommit,
} from "../search-commit";

describe("resolveSearchCommit", () => {
  test("normalizes lowercase VINs before storing pending navigation state", () => {
    expect(resolveSearchCommit(" 1fadp3f29fl123456 ", true)).toEqual({
      kind: "vin",
      value: "1FADP3F29FL123456",
    });
  });

  test("keeps ordinary text queries unchanged apart from trimming", () => {
    expect(resolveSearchCommit("  Grand Marquis ", true)).toEqual({
      kind: "query",
      value: "Grand Marquis",
    });
  });

  test("completes a normalized VIN commit across pending, URL, and Algolia state", async () => {
    const pendingValues: string[] = [];
    const modeChanges: Array<{
      query: string | null;
      vinPattern: string | null;
    }> = [];
    const refinements: string[] = [];

    await executeSearchCommit({
      value: "1fadp3f29fl123456",
      vinPatternSearchReady: true,
      currentVinPattern: "",
      operations: {
        setPendingValue: (value) => {
          pendingValues.push(value);
        },
        changeMode: async (value) => {
          modeChanges.push(value);
        },
        refine: (value) => {
          refinements.push(value);
        },
      },
    });

    expect(pendingValues).toEqual(["1FADP3F29FL123456"]);
    expect(modeChanges).toEqual([
      { query: null, vinPattern: "1FADP3F29FL123456" },
    ]);
    expect(refinements).toEqual([""]);
    expect(
      resolveCommittedSearchSync({
        committedValue: "1FADP3F29FL123456",
        pendingValue: pendingValues.at(-1) ?? null,
        inputValue: "1fadp3f29fl123456",
      }),
    ).toEqual({
      kind: "apply",
      clearPending: true,
      inputValue: "1FADP3F29FL123456",
    });
  });
});
