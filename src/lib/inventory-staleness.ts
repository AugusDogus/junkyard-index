import {
  ACTIVE_INGESTION_SOURCES,
  type IngestionSource,
} from "./ingestion-source";

/**
 * Hours after the last accepted publication before inventory is stale. Daily
 * runs start at 07:00 UTC and publish within hours; 36 hours allows a late
 * publication followed by an early one without flagging a healthy source,
 * and still catches one that misses a whole day. Status checks, admin and
 * every public listing share it.
 */
export const INVENTORY_STALE_AFTER_HOURS = 36;

/**
 * Days after the last accepted publication before a source's vehicles leave
 * the public site. Until then they show with "Last checked N days ago"; the
 * next accepted publication brings them back.
 */
export const INVENTORY_HIDDEN_AFTER_DAYS = 7;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const STALE_AFTER_MS = INVENTORY_STALE_AFTER_HOURS * HOUR_MS;
const HIDDEN_AFTER_MS = INVENTORY_HIDDEN_AFTER_DAYS * DAY_MS;

/**
 * How current a source's or yard's inventory is, from its last accepted
 * publication: current, stale (shown with when it was last checked), or
 * hidden from the public site. `checkedAt` is epoch milliseconds; null means
 * no accepted publication within the lookback, which covers more than the
 * hide window.
 */
export type InventoryStaleness =
  | { kind: "current" }
  | { kind: "stale"; checkedAt: number }
  | { kind: "hidden"; checkedAt: number | null };

/**
 * When each source and yard last had an accepted publication, as ISO
 * strings. `yards` is keyed `source:code` and holds only yards with a date
 * of their own; the rest take their source's date.
 */
export type InventoryCheckDates = {
  sources: Readonly<Partial<Record<string, string>>>;
  yards: Readonly<Partial<Record<string, string>>>;
};

function of(lastPublishedAt: number | null, now: number): InventoryStaleness {
  if (lastPublishedAt === null) return { kind: "hidden", checkedAt: null };
  const age = now - lastPublishedAt;
  if (age <= STALE_AFTER_MS) return { kind: "current" };
  if (age <= HIDDEN_AFTER_MS)
    return { kind: "stale", checkedAt: lastPublishedAt };
  return { kind: "hidden", checkedAt: lastPublishedAt };
}

function isStale(checkedAt: string | undefined, now: number): boolean {
  return (
    checkedAt !== undefined && now - Date.parse(checkedAt) > STALE_AFTER_MS
  );
}

function checkedAt(
  dates: InventoryCheckDates,
  source: string,
  code: string,
): string | null {
  return dates.yards[`${source}:${code}`] ?? dates.sources[source] ?? null;
}

/** How current a set of yards' inventory is. */
export type InventoryFreshness = {
  /** The newest update among them, or null when none has a known date. */
  latest: string | null;
  /** How many of them updated within INVENTORY_STALE_AFTER_HOURS. */
  current: number;
  total: number;
};

export const InventoryStaleness = {
  of,

  /** Whether inventory last published then is still current at `now`. */
  isCurrent(lastPublishedAt: number | null, now: number): boolean {
    return of(lastPublishedAt, now).kind === "current";
  },

  /**
   * "Last checked N days ago" for inventory last published at `checkedAt`,
   * or null while it is current or when the date is unknown.
   */
  label(checkedAt: string | null, now: number): string | null {
    if (checkedAt === null || !isStale(checkedAt, now)) return null;
    const days = Math.floor((now - Date.parse(checkedAt)) / DAY_MS);
    return `Last checked ${days} ${days === 1 ? "day" : "days"} ago`;
  },

  /**
   * The active sources whose vehicles leave the public site now: those with
   * no accepted publication within INVENTORY_HIDDEN_AFTER_DAYS. `published`
   * maps sources to their newest accepted publication in a lookback longer
   * than that window; a missing source has none. Retired sources stay on
   * their own list.
   */
  hiddenSources(
    published: ReadonlyMap<string, number | null>,
    now: number,
  ): IngestionSource[] {
    return ACTIVE_INGESTION_SOURCES.filter(
      (source) => of(published.get(source) ?? null, now).kind === "hidden",
    );
  },

  /**
   * How current these yards are, by their sources' last accepted
   * publications, so a page listing several sources says how many are
   * current rather than quoting only the newest date.
   */
  coverage(
    yards: readonly { source: string }[],
    sources: Readonly<Partial<Record<string, string>>>,
    now: number,
  ): InventoryFreshness {
    let latest: string | null = null;
    let current = 0;
    for (const yard of yards) {
      const date = sources[yard.source];
      if (date === undefined) continue;
      if (!isStale(date, now)) current += 1;
      if (latest === null || date > latest) latest = date;
    }
    return { latest, current, total: yards.length };
  },

  /** When a yard was last checked: its own date, else its source's. */
  checkedAt,

  /**
   * Only the dates past the stale threshold, which is all a browser needs to
   * label hits: `checkedAt` answers the same for every stale yard, and null
   * (no label) for current ones.
   */
  staleOnly(dates: InventoryCheckDates, now: number): InventoryCheckDates {
    const sources = Object.fromEntries(
      Object.entries(dates.sources).filter(([, at]) => isStale(at, now)),
    );
    const yards = Object.fromEntries(
      // A yard dated after its stale source keeps its own date.
      Object.entries(dates.yards).filter(
        ([key, at]) =>
          isStale(at, now) || key.slice(0, key.indexOf(":")) in sources,
      ),
    );
    return { sources, yards };
  },
} as const;
