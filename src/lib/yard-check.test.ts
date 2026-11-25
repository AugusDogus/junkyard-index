import { describe, expect, test } from "bun:test";
import { YardCheck, type ReportedYardCheckOutcome } from "./yard-check";

describe("yard check reports", () => {
  test("a yard reported twice in a run keeps the less proven result", () => {
    const reports = new Map<string, ReportedYardCheckOutcome>();
    YardCheck.merge(reports, [
      { locationCode: "a", outcome: "fetched" },
      { locationCode: "b", outcome: "blocked" },
      { locationCode: "c", outcome: "replayed" },
    ]);
    YardCheck.merge(reports, [
      { locationCode: "a", outcome: "replayed" },
      { locationCode: "b", outcome: "fetched" },
      { locationCode: "c", outcome: "preserved" },
    ]);
    expect(Object.fromEntries(reports)).toEqual({
      a: "replayed",
      b: "blocked",
      c: "preserved",
    });
  });

  test("lists snapshot yards without a result, once each", () => {
    expect(
      YardCheck.unreported(
        [
          { locationCode: "b" },
          { locationCode: "a" },
          { locationCode: "b" },
          { locationCode: "c" },
        ],
        new Map([["c", "fetched"]]),
      ),
    ).toEqual(["a", "b"]);
  });

  test("label dates keep yards never proven fetched as null", () => {
    expect(
      YardCheck.checkDates([
        {
          source: "pyp",
          code: "a",
          lastCheckedAt: new Date("2026-11-25T07:00:00Z"),
        },
        { source: "pyp", code: "b", lastCheckedAt: null },
      ]),
    ).toEqual({ "pyp:a": "2026-11-25T07:00:00.000Z", "pyp:b": null });
  });
});
