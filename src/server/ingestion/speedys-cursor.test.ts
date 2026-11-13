import { describe, expect, test } from "bun:test";
import { SpeedysCursor } from "./speedys-cursor";
import { parseSpeedysCatalog } from "./speedys-parser";
import { speedysSaved } from "./speedys-test-fixtures";
import { SPEEDYS_CATALOG } from "./speedys-yard-metadata";

describe("Speedys strict durable cursor", () => {
  test("roundtrips initial state and rejects foreign fields, scope and corruption", () => {
    const raw = SpeedysCursor.serialize(SpeedysCursor.initial);
    expect(SpeedysCursor.parse(raw)).toEqual(SpeedysCursor.initial);
    expect(() =>
      SpeedysCursor.parse(raw.replace('"speedys"', '"other"')),
    ).toThrow();
    expect(() =>
      SpeedysCursor.parse(
        JSON.stringify({ ...SpeedysCursor.initial, extra: true }),
      ),
    ).toThrow();
    expect(() =>
      SpeedysCursor.parse(
        JSON.stringify({ ...SpeedysCursor.initial, startedAt: 10 }),
      ),
    ).toThrow();
    expect(() => SpeedysCursor.parse(" ".repeat(1024 * 1024 + 1))).toThrow();
  });
  test("rejects checksum-correct skipped and malformed native prefixes", () => {
    expect(() =>
      SpeedysCursor.checkpoint({ ...SpeedysCursor.initial, phase: "complete" }),
    ).toThrow(/prefix/);
    const page = parseSpeedysCatalog(speedysSaved.default, SPEEDYS_CATALOG);
    expect(() =>
      SpeedysCursor.checkpoint({
        ...SpeedysCursor.initial,
        startedAt: Date.now(),
        pages: [page],
        phase: "details",
      }),
    ).toThrow(/prefix/);
    expect(() =>
      SpeedysCursor.checkpoint({
        ...SpeedysCursor.initial,
        startedAt: Date.now(),
        pages: [
          { ...page, categories: [{ id: "478", make: "NISSAN", count: 2 }] },
        ],
      }),
    ).toThrow(/union/);
  });
});
