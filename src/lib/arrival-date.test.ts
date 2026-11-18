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

test("calendar arrivals keep their day in America/Chicago", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/Chicago";
  try {
    expect(ArrivalDate.format({ kind: "yard", date: "2026-09-17" })).toBe(
      "Sep 17, 2026",
    );
    expect(ArrivalDate.format({ kind: "yard", date: "2026-01-01" })).toBe(
      "Jan 1, 2026",
    );
    expect(
      ArrivalDate.format({ kind: "seen", date: "2026-09-17T01:00:00Z" }),
    ).toBe("Seen Sep 16, 2026");
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
