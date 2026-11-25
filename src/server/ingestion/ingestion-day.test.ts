import { expect, test } from "bun:test";
import { IngestionDay } from "./ingestion-day";

test.each([
  ["2026-09-20T06:59:59.999Z", "2026-09-19"],
  ["2026-09-20T07:00:00.000Z", "2026-09-20"],
  ["2027-01-01T01:00:00.000Z", "2026-12-31"],
])("ingestion and delivery share the day for %s", (timestamp, day) => {
  const now = new Date(timestamp);
  expect(IngestionDay.key(now)).toBe(day);
  expect(IngestionDay.start(now).toISOString()).toBe(`${day}T07:00:00.000Z`);
});

test("a day ends when the next one starts", () => {
  expect(new Date(IngestionDay.end("2026-12-31")).toISOString()).toBe(
    "2027-01-01T07:00:00.000Z",
  );
  expect(IngestionDay.key(new Date(IngestionDay.end("2026-09-19")))).toBe(
    "2026-09-20",
  );
});
