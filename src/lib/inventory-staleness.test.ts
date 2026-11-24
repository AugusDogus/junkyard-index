import { describe, expect, test } from "bun:test";
import { RETIRED_INGESTION_SOURCES } from "./ingestion-source";
import {
  INVENTORY_HIDDEN_AFTER_DAYS,
  INVENTORY_STALE_AFTER_HOURS,
  InventoryStaleness,
} from "./inventory-staleness";

const now = Date.parse("2026-11-24T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const hoursAgo = (hours: number) => now - hours * HOUR_MS;
const iso = (at: number) => new Date(at).toISOString();

describe("InventoryStaleness.of", () => {
  test("is current through 36 hours, stale after that and hidden after 7 days", () => {
    expect(INVENTORY_STALE_AFTER_HOURS).toBe(36);
    expect(INVENTORY_HIDDEN_AFTER_DAYS).toBe(7);
    expect(InventoryStaleness.of(hoursAgo(36), now)).toEqual({
      kind: "current",
    });
    expect(InventoryStaleness.of(hoursAgo(37), now)).toEqual({
      kind: "stale",
      checkedAt: hoursAgo(37),
    });
    expect(InventoryStaleness.of(hoursAgo(7 * 24), now)).toEqual({
      kind: "stale",
      checkedAt: hoursAgo(7 * 24),
    });
    expect(InventoryStaleness.of(hoursAgo(7 * 24 + 1), now)).toEqual({
      kind: "hidden",
      checkedAt: hoursAgo(7 * 24 + 1),
    });
  });

  test("hides a source with no accepted publication in the lookback", () => {
    expect(InventoryStaleness.of(null, now)).toEqual({
      kind: "hidden",
      checkedAt: null,
    });
  });
});

describe("InventoryStaleness.label", () => {
  test("says nothing while current and counts whole days once stale", () => {
    expect(InventoryStaleness.label(iso(hoursAgo(20)), now)).toBeNull();
    expect(InventoryStaleness.label(iso(hoursAgo(40)), now)).toBe(
      "Last checked 1 day ago",
    );
    expect(InventoryStaleness.label(iso(hoursAgo(3 * 24 + 5)), now)).toBe(
      "Last checked 3 days ago",
    );
    expect(InventoryStaleness.label(iso(hoursAgo(13 * 24)), now)).toBe(
      "Last checked 13 days ago",
    );
  });
});

describe("InventoryStaleness.hiddenSources", () => {
  test("hides active sources without an accepted publication in 7 days, and shows them again once one lands", () => {
    const before = new Map<string, number | null>([
      ["pyp", hoursAgo(4)],
      ["hollanderstores", hoursAgo(82)],
      ["upullrparts", hoursAgo(13 * 24)],
    ]);
    const hidden = InventoryStaleness.hiddenSources(before, now);
    expect(hidden).toContain("upullrparts");
    expect(hidden).not.toContain("pyp");
    expect(hidden).not.toContain("hollanderstores");
    // A source without any publication in the lookback is hidden too.
    expect(hidden).toContain("row52");

    const recovered = new Map(before).set("upullrparts", hoursAgo(1));
    expect(InventoryStaleness.hiddenSources(recovered, now)).not.toContain(
      "upullrparts",
    );
  });

  test("leaves retired sources to the retired list", () => {
    const hidden = InventoryStaleness.hiddenSources(new Map(), now);
    for (const source of RETIRED_INGESTION_SOURCES)
      expect(hidden).not.toContain(source);
  });
});

describe("InventoryStaleness.checkedAt", () => {
  const dates = {
    sources: { urgiis: iso(hoursAgo(15)), upullrparts: iso(hoursAgo(300)) },
    yards: { "urgiis:linders": iso(hoursAgo(50)) },
  };

  test("prefers the yard's own date, so a preserved yard reads as stale while its source is current", () => {
    expect(InventoryStaleness.checkedAt(dates, "urgiis", "linders")).toBe(
      iso(hoursAgo(50)),
    );
    expect(InventoryStaleness.checkedAt(dates, "urgiis", "other")).toBe(
      iso(hoursAgo(15)),
    );
  });

  test("falls back to the source's date for a yard tracked before yard dates, and null when neither is known", () => {
    expect(InventoryStaleness.checkedAt(dates, "upullrparts", "UPRRP-1")).toBe(
      iso(hoursAgo(300)),
    );
    expect(InventoryStaleness.checkedAt(dates, "pyp", "1")).toBeNull();
  });

  test("staleOnly keeps only dates past 36 hours and still answers the same for every yard", () => {
    const stale = InventoryStaleness.staleOnly(dates, now);
    expect(stale).toEqual({
      sources: { upullrparts: iso(hoursAgo(300)) },
      yards: { "urgiis:linders": iso(hoursAgo(50)) },
    });
    for (const [source, code] of [
      ["urgiis", "linders"],
      ["upullrparts", "UPRRP-1"],
    ] as const)
      expect(InventoryStaleness.checkedAt(stale, source, code)).toBe(
        InventoryStaleness.checkedAt(dates, source, code),
      );
    expect(
      InventoryStaleness.label(
        InventoryStaleness.checkedAt(stale, "urgiis", "other"),
        now,
      ),
    ).toBeNull();
  });
});

describe("InventoryStaleness.coverage", () => {
  test("counts only yards checked within 36 hours as current, and still names the newest date", () => {
    const sources = {
      pyp: iso(hoursAgo(4)),
      hollanderstores: iso(hoursAgo(82)),
    };
    expect(
      InventoryStaleness.coverage(
        [{ source: "pyp" }, { source: "hollanderstores" }, { source: "row52" }],
        sources,
        now,
      ),
    ).toEqual({ latest: iso(hoursAgo(4)), current: 1, total: 3 });
    expect(
      InventoryStaleness.coverage(
        [{ source: "hollanderstores" }],
        sources,
        now,
      ),
    ).toEqual({ latest: iso(hoursAgo(82)), current: 0, total: 1 });
  });
});
