import { HiddenSources } from "~/lib/hidden-source";
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
 * Where the held key came from. A rendered key reflects the server's cached
 * tier lookup and can lag a plan change. A fetched key comes from
 * `/api/search-key`, which asks the billing provider directly; `forPaid` is
 * the kind of plan the page showed when it asked.
 */
type HeldKey = {
  grant: SearchKeyGrant;
  renewAtMs: number;
  /** The grant's hidden sources, built once so readers get one object. */
  hidden: HiddenSources;
} & ({ source: "rendered" } | { source: "fetched"; forPaid: boolean | null });

/** A key Algolia refused is fetched again at most this often. */
const REJECTION_REFETCH_MS = 60_000;

/**
 * The browser's current search key. Pages prime it with the key their server
 * render minted, and each search reads it through `current`, which fetches a
 * new one when the key is missing or about to expire. Expiry is measured on
 * the browser's clock from when each key arrived. One instance per tab;
 * server renders never use this (they search with their own key).
 */
function create(fetcher: Fetch, now: () => number = () => Date.now()) {
  let held: HeldKey | null = null;
  let lastRejectionMs: number | null = null;
  let lastPrimed: string | null = null;
  // The kind of plan the page last showed, passed to `renewFor`.
  let shownPaid: boolean | null = null;
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

  /** The key for the next search, fetching a new one when it is due. */
  async function current(): Promise<string> {
    if (held && now() < held.renewAtMs) return held.grant.apiKey;
    if (!pending) {
      const forPaid = shownPaid;
      pending = request()
        .then((fetched) => {
          held = {
            source: "fetched",
            grant: fetched,
            forPaid,
            renewAtMs: SearchKeyGrant.renewAtMs(fetched, now()),
            hidden: HiddenSources.of(fetched.hiddenSources),
          };
          // Only fetches notify: prime and renewFor run while rendering,
          // and readers see their result through `tier` in the same render.
          for (const listener of listeners) listener();
          return fetched;
        })
        .finally(() => {
          pending = null;
        });
    }
    return (await pending).apiKey;
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
      const renewAtMs = SearchKeyGrant.renewAtMs(next, now());
      if (!held || renewAtMs > held.renewAtMs)
        held = {
          source: "rendered",
          grant: next,
          renewAtMs,
          hidden: HiddenSources.of(next.hiddenSources),
        };
    },
    /**
     * Called when Algolia refused `apiKey`. Returns whether retrying the
     * search is worthwhile: the key was already replaced, or it is dropped
     * now so the retry fetches another. A key refused again within a minute
     * is not refetched, so a server minting bad keys cannot turn every
     * search into a key fetch.
     */
    reject(apiKey: string): boolean {
      if (held?.grant.apiKey !== apiKey) return true;
      const nowMs = now();
      if (
        lastRejectionMs !== null &&
        nowMs - lastRejectionMs < REJECTION_REFETCH_MS
      )
        return false;
      lastRejectionMs = nowMs;
      held = null;
      return true;
    },
    /**
     * Replaces a key minted for a different kind of plan than the page shows:
     * always for a rendered key (such as
     * right after a checkout), and for a fetched key once the page shows a
     * different plan than it did when that key was fetched. A fetched key
     * minted for the plan the page still shows is the server's answer and
     * stands, so searches do not each fetch a key.
     */
    renewFor(tier: PlanTier): void {
      const paid = isPaidPlanTier(tier);
      shownPaid = paid;
      if (!held || isPaidPlanTier(held.grant.tier) === paid) return;
      if (held.source === "fetched" && held.forPaid === paid) return;
      held = null;
      // Fetch the replacement now, not on the next search: a capped page
      // may not search again, and its cap follows this key's tier. This runs
      // during render, so the fetch starts after it; a failure surfaces on
      // the next search, which tries again.
      queueMicrotask(() => {
        current().catch(() => undefined);
      });
    },
    /** The tier of the key searches use now; null while one is fetched. */
    tier(): PlanTier | null {
      return held?.grant.tier ?? null;
    },
    /**
     * The sources the held key leaves out; null while one is fetched. The
     * page filters and lists with it, so a renewed key brings a hide or
     * show to an open tab.
     */
    hiddenSources(): HiddenSources | null {
      return held?.hidden ?? null;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    current,
  };
}

export type BrowserSearchKey = ReturnType<typeof create>;

export const BrowserSearchKey = { create } as const;

/** This tab's key. */
export const browserSearchKey = BrowserSearchKey.create((input, init) =>
  fetch(input, init),
);
