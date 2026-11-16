import { expect, test } from "bun:test";
import { ArrivalDate } from "./arrival-date";

test("validates dates before formatting even a malformed dated variant", () => {
  expect(ArrivalDate.format({ kind: "yard", date: "garbage" })).toBe(
    "Date unknown",
  );
  expect(ArrivalDate.format({ kind: "seen", date: "" })).toBe("Date unknown");
  for (const input of [
    null,
    undefined,
    "",
    "garbage",
    0,
    {},
    new Date("invalid"),
  ]) {
    expect(ArrivalDate.from(input, null)).toEqual({ kind: "unknown" });
    expect(ArrivalDate.parse(input)).toEqual({ kind: "unknown" });
  }
});
