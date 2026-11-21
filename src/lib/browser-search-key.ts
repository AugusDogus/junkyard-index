import { isPaidPlanTier, type PlanTier } from "~/lib/plans";
import { SearchKeyGrant } from "~/lib/search-key-grant";

/** A search key the server would not issue. Search stays unavailable. */
export class SearchKeyUnavailable extends Error {
  readonly _tag = "SearchKeyUnavailable";
  constructor(readonly status: number | null) {
    super(
      `Could not get a search key from /api/search-key (${status === null ? "no response" : `HTTP ${status}`}), so search cannot run. Filters and the page are unchanged; the next search retries, or reload the page.`,
    );
    this.name = "SearchKeyUnavailable";
  }
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * The browser's current search key. Pages prime it with the key their server
 * render minted, and each search reads it through `current`, which fetches a
 * new one when the key is missing or about to expire. One instance per tab;
 * server renders never use this (they search with their own key).
 */
function create(fetcher: Fetch) {
  let grant: SearchKeyGrant | null = null;
  let lastPrimed: string | null = null;
  // The kind of plan (paid or not) the key was last renewed for.
  let renewedForPaid: boolean | null = null;
  let pending: Promise<SearchKeyGrant> | null = null;
  const listeners = new Set<() => void>();

  async function request(): Promise<SearchKeyGrant> {
    let response: Response;
    try {
      response = await fetcher("/api/search-key", {
        cache: "no-store",
        credentials: "same-origin",
      });
    } catch {
      throw new SearchKeyUnavailable(null);
    }
    if (!response.ok) throw new SearchKeyUnavailable(response.status);
    return SearchKeyGrant.parse(await response.json());
  }

  return {
    /**
     * Uses a key the server rendered into the page. Each key primes once, so
     * a re-render cannot restore a key that `renewFor` or a newer fetch
     * replaced.
     */
    prime(next: SearchKeyGrant): void {
      if (next.apiKey === lastPrimed) return;
      lastPrimed = next.apiKey;
      if (!grant || next.validUntil > grant.validUntil) grant = next;
    },
    /**
     * Drops a key minted for a different kind of plan than the page now
     * shows (such as after a checkout), so the next search fetches one. It
     * renews once per change: if the server mints the same kind again, its
     * answer stands, rather than every search fetching a new key.
     */
    renewFor(tier: PlanTier): void {
      const paid = isPaidPlanTier(tier);
      if (
        grant === null ||
        isPaidPlanTier(grant.tier) === paid ||
        renewedForPaid === paid
      )
        return;
      renewedForPaid = paid;
      grant = null;
    },
    /** The tier of the key searches use now; null while one is fetched. */
    tier(): PlanTier | null {
      return grant?.tier ?? null;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async current(nowMs: number): Promise<string> {
      if (grant && !SearchKeyGrant.isExpiring(grant, nowMs))
        return grant.apiKey;
      pending ??= request()
        .then((fetched) => {
          grant = fetched;
          // Only fetches notify: prime and renewFor run while rendering,
          // and readers see their result through `tier` in the same render.
          for (const listener of listeners) listener();
          return fetched;
        })
        .finally(() => {
          pending = null;
        });
      return (await pending).apiKey;
    },
  };
}

export type BrowserSearchKey = ReturnType<typeof create>;

export const BrowserSearchKey = { create } as const;

/** This tab's key. */
export const browserSearchKey = BrowserSearchKey.create((input, init) =>
  fetch(input, init),
);
