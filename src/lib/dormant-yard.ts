import { YardPath } from "./yard-path";

/**
 * Days a yard keeps its page after it stops showing vehicles (owner
 * decision, November 26, 2026). Until then the page answers 200 with an
 * honest empty state, so a provider outage or a yard's empty spell does not
 * turn its URL into a 404; after it, the page is gone until the yard shows
 * vehicles again.
 */
export const DORMANT_YARD_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Why a yard that shows no vehicles still has a page, and since when (ISO):
 * - unconfirmed: its source has had no accepted publication for
 *   INVENTORY_HIDDEN_AFTER_DAYS, so the automatic hide holds its vehicles
 *   back. `since` is the yard's last accepted publication.
 * - emptied: its last live vehicle departed (`departed_yard`). `since` is
 *   when.
 * A yard the owner hid, or one of a retired source, is never dormant.
 */
export type DormantYard =
  | { kind: "unconfirmed"; since: string }
  | { kind: "emptied"; since: string };

type Identity = {
  source: string;
  code: string;
  name: string;
  city: string;
  state: string;
};

/** Where the yard's page would be if no other yard shared its name. */
function ownHref(yard: Identity): string | null {
  return YardPath.assign([yard]).get(YardPath.key(yard))?.href ?? null;
}

/** Whether a yard dormant this way still keeps its page at `now`. */
function isCurrent(dormant: DormantYard, now: number): boolean {
  return now - Date.parse(dormant.since) <= DORMANT_YARD_DAYS * DAY_MS;
}

/**
 * The candidates that keep a page at `now`, each with its path: those
 * dormant for at most DORMANT_YARD_DAYS. Listed yards keep the paths they
 * have, so a dormant yard never moves one. A candidate named like a listed
 * yard in its region (same name and city) was succeeded by it, such as a
 * yard that moved to another source, and gets no page; nor does one listed
 * itself or outside a known region.
 */
function pages<Yard extends Identity>(
  listed: readonly Identity[],
  candidates: readonly (Yard & { dormant: DormantYard })[],
  now: number,
): (Yard & { dormant: DormantYard; path: YardPath })[] {
  const listedKeys = new Set(listed.map(YardPath.key));
  const listedHrefs = new Set(listed.map(ownHref));
  const kept = candidates.filter((yard) => {
    if (listedKeys.has(YardPath.key(yard))) return false;
    if (!isCurrent(yard.dormant, now)) return false;
    const href = ownHref(yard);
    return href !== null && !listedHrefs.has(href);
  });
  // Dormant yards that share a name with each other are told apart the way
  // listed ones are.
  const paths = YardPath.assign([...listed, ...kept]);
  return kept.flatMap((yard) => {
    const path = paths.get(YardPath.key(yard));
    return path ? [{ ...yard, path }] : [];
  });
}

export const DormantYard = { isCurrent, pages } as const;
