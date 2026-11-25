import { describe, expect, test } from "bun:test";
import { ACTIVE_INGESTION_SOURCES } from "~/lib/ingestion-source";
import { YardCheckHealth, type YardCheckRow } from "./yard-check-health";

const now = new Date("2026-11-25T12:00:00Z");
const hoursAgo = (hours: number) => now.getTime() - hours * 60 * 60 * 1000;

function row(code: string, checkedHoursAgo: number | null): YardCheckRow {
  return {
    source: "pyp",
    locationCode: code,
    vehicleCount: 20,
    outcome: checkedHoursAgo === null ? "unreported" : "fetched",
    lastCheckedAt: checkedHoursAgo === null ? null : hoursAgo(checkedHoursAgo),
    lastChangedAt: hoursAgo(1),
    consecutiveUncheckedRuns: 0,
  };
}

describe("per-yard check health", () => {
  test("a yard unchecked for 7 days would hide while few yards are stale", () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, i) => row(`fresh-${i}`, 2)),
      { ...row("gone", 8 * 24), outcome: "blocked" as const },
    ];
    const health = YardCheckHealth.evaluate(
      rows,
      ACTIVE_INGESTION_SOURCES,
      now,
    );
    expect(health.autoHide).toEqual({ status: "applied", yards: ["pyp:gone"] });
    expect(health.notChecked.map((yard) => yard.code)).toEqual(["gone"]);
  });

  test("the outage guard holds every yard once a fifth of them are stale", () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => row(`fresh-${i}`, 2)),
      row("gone", 8 * 24),
      row("late", 40),
    ];
    expect(
      YardCheckHealth.evaluate(rows, ACTIVE_INGESTION_SOURCES, now).autoHide,
    ).toEqual({ status: "outage", stale: 2, checked: 10, held: ["pyp:gone"] });
  });

  test("a yard with no check record counts as unreported, and retired sources are skipped", () => {
    const health = YardCheckHealth.evaluate(
      [
        { ...row("new", null), outcome: null },
        { ...row("old", null), source: "upullitne" },
      ],
      ACTIVE_INGESTION_SOURCES,
      now,
    );
    expect(health.checked).toBe(1);
    expect(health.unreported).toMatchObject([
      { code: "new", outcome: "unreported", lastCheckedAt: null },
    ]);
  });

  test("frozen needs a current check, 100 cars and 3 days without a change", () => {
    const frozen = {
      ...row("frozen", 2),
      vehicleCount: 100,
      lastChangedAt: hoursAgo(72),
    };
    const health = YardCheckHealth.evaluate(
      [
        frozen,
        { ...frozen, locationCode: "changed", lastChangedAt: hoursAgo(71) },
        { ...frozen, locationCode: "small", vehicleCount: 99 },
        { ...frozen, locationCode: "unknown", lastChangedAt: null },
        { ...frozen, locationCode: "late", lastCheckedAt: hoursAgo(40) },
      ],
      ACTIVE_INGESTION_SOURCES,
      now,
    );
    expect(health.frozen.map((yard) => yard.code)).toEqual(["frozen"]);
    expect(health.notChecked.map((yard) => yard.code)).toEqual(["late"]);
  });
});
