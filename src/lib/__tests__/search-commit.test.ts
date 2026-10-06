import { describe, expect, test } from "bun:test";
import {
  executeSearchCommit,
  resolveCommittedSearchSync,
  resolveSearchCommit,
  type PendingSearchCommit,
} from "../search-commit";

describe("resolveSearchCommit", () => {
  test("preserves a newer draft when an older search commit is acknowledged", () => {
    expect(
      resolveCommittedSearchSync({
        committedValue: "toyota venza",
        pendingCommit: { value: "toyota venza", inputValue: "toyota venza" },
        inputValue: "h",
      }),
    ).toEqual({ kind: "apply", clearPending: true, inputValue: null });
  });

  test("keeps waiting when a newer commit is still pending", () => {
    expect(
      resolveCommittedSearchSync({
        committedValue: "toyota venza",
        pendingCommit: { value: "honda", inputValue: "honda" },
        inputValue: "honda civic",
      }),
    ).toEqual({ kind: "wait" });
  });

  test("accepts external query changes when no local commit is pending", () => {
    expect(
      resolveCommittedSearchSync({
        committedValue: "ford",
        pendingCommit: null,
        inputValue: "honda",
      }),
    ).toEqual({ kind: "apply", clearPending: false, inputValue: "ford" });
  });

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
    const pendingCommits: PendingSearchCommit[] = [];
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
        setPendingCommit: (commit) => {
          pendingCommits.push(commit);
        },
        changeMode: async (value) => {
          modeChanges.push(value);
        },
        refine: (value) => {
          refinements.push(value);
        },
      },
    });

    expect(pendingCommits).toEqual([
      { value: "1FADP3F29FL123456", inputValue: "1fadp3f29fl123456" },
    ]);
    expect(modeChanges).toEqual([
      { query: null, vinPattern: "1FADP3F29FL123456" },
    ]);
    expect(refinements).toEqual([""]);
    expect(
      resolveCommittedSearchSync({
        committedValue: "1FADP3F29FL123456",
        pendingCommit: pendingCommits.at(-1) ?? null,
        inputValue: "1fadp3f29fl123456",
      }),
    ).toEqual({
      kind: "apply",
      clearPending: true,
      inputValue: "1FADP3F29FL123456",
    });
  });
});
