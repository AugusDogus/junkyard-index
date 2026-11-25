import { describe, expect, test } from "bun:test";
import {
  ACTIVE_INGESTION_SOURCES,
  RETIRED_INGESTION_SOURCES,
} from "./ingestion-source";
import {
  INVENTORY_HIDDEN_AFTER_DAYS,
  INVENTORY_STALE_AFTER_HOURS,
  InventoryStaleness,
  OUTAGE_STALE_SHARE,
  UNKNOWN_CHECK_LABEL,
} from "./inventory-staleness";

const now = Date.parse("2026-11-24T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const hoursAgo = (hours: number) => now - hours * HOUR_MS;
const iso = (at: number) => new Date(at).toISOString();

/** Every active source published 4 hours ago, as on a healthy day, then `changes`. */
function healthy(
  changes: Record<string, number | null> = {},
): Map<string, number | null> {
  const published = new Map<string, number | null>(
    ACTIVE_INGESTION_SOURCES.map((source) => [source, hoursAgo(4)]),
  );
  for (const [source, at] of Object.entries(changes)) published.set(source, at);
  return published;
}

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
    const before = healthy({
      hollanderstores: hoursAgo(82),
      upullrparts: hoursAgo(13 * 24),
      // A source without any publication in the lookback is hidden too.
      row52: null,
    });
    const hidden = InventoryStaleness.hiddenSources(before, now);
    expect([...hidden].sort()).toEqual(["row52", "upullrparts"]);

    const recovered = new Map(before).set("upullrparts", hoursAgo(1));
    expect(InventoryStaleness.hiddenSources(recovered, now)).not.toContain(
      "upullrparts",
    );
  });

  test("leaves retired sources to the retired list", () => {
    const published = healthy();
    for (const source of RETIRED_INGESTION_SOURCES) published.set(source, null);
    const hidden = InventoryStaleness.hiddenSources(published, now);
    for (const source of RETIRED_INGESTION_SOURCES)
      expect(hidden).not.toContain(source);
  });

  test("hides nothing while at least 20% of active sources are stale, so an ingestion outage shows Last checked labels instead of an empty site", () => {
    expect(OUTAGE_STALE_SHARE).toBe(0.2);
    const outageAt = InventoryStaleness.outageAfterStale(
      ACTIVE_INGESTION_SOURCES.length,
    );
    const stale = ACTIVE_INGESTION_SOURCES.slice(0, outageAt);
    const outage = healthy(
      Object.fromEntries(stale.map((source) => [source, hoursAgo(8 * 24)])),
    );
    expect(InventoryStaleness.hiddenSources(outage, now)).toEqual([]);
    expect(InventoryStaleness.autoHide(outage, now)).toEqual({
      status: "outage",
      stale: outageAt,
      checked: ACTIVE_INGESTION_SOURCES.length,
      held: stale,
    });

    // One fewer stale source is not an outage: the 7-day hide applies.
    const degraded = healthy(
      Object.fromEntries(
        stale.slice(1).map((source) => [source, hoursAgo(8 * 24)]),
      ),
    );
    expect(InventoryStaleness.hiddenSources(degraded, now)).toEqual(
      stale.slice(1),
    );

    // Stale sources under 7 days count toward the outage too.
    const mixed = healthy(
      Object.fromEntries(
        stale.map((source, index) => [
          source,
          index === 0 ? hoursAgo(8 * 24) : hoursAgo(40),
        ]),
      ),
    );
    expect(InventoryStaleness.hiddenSources(mixed, now)).toEqual([]);
  });

  test("hides nothing on a database with no recent runs, which reads as an outage", () => {
    expect(InventoryStaleness.hiddenSources(new Map(), now)).toEqual([]);
  });
});

describe("InventoryStaleness.classes", () => {
  test("names each active source that is not current by what the site does with it, and counts a held source as stale", () => {
    expect(
      InventoryStaleness.classes(
        healthy({ hollanderstores: hoursAgo(40), upullrparts: hoursAgo(200) }),
        now,
      ),
    ).toEqual({ hollanderstores: "stale", upullrparts: "hidden" });
    expect(InventoryStaleness.classes(healthy(), now)).toEqual({});
    const outage = InventoryStaleness.classes(new Map(), now);
    expect(Object.values(outage).every((kind) => kind === "stale")).toBe(true);
    expect(Object.keys(outage)).toHaveLength(ACTIVE_INGESTION_SOURCES.length);
  });

  test("changedClasses lists the sources that moved between two checks", () => {
    expect(
      InventoryStaleness.changedClasses(
        { pyp: "stale", upullrparts: "stale", hollanderstores: "stale" },
        { upullrparts: "hidden", row52: "stale", hollanderstores: "stale" },
      ).sort(),
    ).toEqual(["pyp", "row52", "upullrparts"]);
  });
});

describe("InventoryStaleness.newBadgeReference", () => {
  test("drops the New reference when a vehicle's yard is labeled Last checked", () => {
    const published = iso(hoursAgo(5 * 24));
    expect(
      InventoryStaleness.newBadgeReference(
        published,
        "Last checked 5 days ago",
      ),
    ).toBeNull();
    expect(InventoryStaleness.newBadgeReference(published, null)).toBe(
      published,
    );
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

  test("labelFor labels a yard by its own date, else its source's, from the caller's clock", () => {
    expect(InventoryStaleness.labelFor(dates, "urgiis", "linders", now)).toBe(
      "Last checked 2 days ago",
    );
    expect(InventoryStaleness.labelFor(dates, "urgiis", "other", now)).toBe(
      null,
    );
    expect(
      InventoryStaleness.labelFor(dates, "upullrparts", "UPRRP-1", now),
    ).toBe("Last checked 12 days ago");
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

  test("a yard reported on but never proven fetched never borrows its source's current date", () => {
    const unproven = {
      sources: { urgiis: iso(hoursAgo(4)) },
      yards: { "urgiis:norbs": null },
    };
    expect(
      InventoryStaleness.checkedAt(unproven, "urgiis", "norbs"),
    ).toBeNull();
    expect(InventoryStaleness.labelFor(unproven, "urgiis", "norbs", now)).toBe(
      UNKNOWN_CHECK_LABEL,
    );
    const stale = InventoryStaleness.staleOnly(unproven, now);
    expect(stale).toEqual({ sources: {}, yards: { "urgiis:norbs": null } });
    expect(InventoryStaleness.labelFor(stale, "urgiis", "norbs", now)).toBe(
      UNKNOWN_CHECK_LABEL,
    );
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
