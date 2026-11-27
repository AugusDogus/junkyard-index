"use client";

import type { IndexUiState, UiState } from "instantsearch.js";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryStates } from "nuqs";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useInstantSearchContext } from "react-instantsearch";
import { ALGOLIA_INDEX_NAME } from "~/lib/constants";
import {
  SearchUrl,
  type SearchUrlValues,
  type SearchUrlWrite,
} from "~/lib/search-url";
import { YardMapUrl } from "~/lib/yard-map-url";
import {
  SearchInputHistory,
  type SearchHistoryWrite,
} from "./search-input-history";
import { getSearchableVinPattern } from "./search-routing";
import { SearchUrlUiState, type SearchUrlPolicy } from "./search-url-ui-state";

type InstantSearchInstance = ReturnType<typeof useInstantSearchContext>;

/** The window, radius and origin, which Configure searches with. */
export type SearchAreaWrite = Pick<
  SearchUrlWrite,
  "legacyArrivalWindow" | "arrivalWindow" | "radius" | "lat" | "lng"
>;
const AREA_KEYS = [
  "legacyArrivalWindow",
  "arrivalWindow",
  "radius",
  "lat",
  "lng",
] as const satisfies readonly (keyof SearchAreaWrite)[];

/** What the search page reads from and writes to the /search URL. */
export interface SearchUrlOwner {
  /** The URL's values, including writes nuqs has not flushed yet. */
  values: SearchUrlValues;
  /** Writes only the window, radius or origin. */
  writeArea(area: SearchAreaWrite, history: "push" | "replace"): Promise<void>;
  /**
   * The `q` the next search write starts from: a VIN, which InstantSearch
   * does not search (it searches ""), or the words or nothing replacing one.
   */
  setNextQuery(q: string | null): void;
  /**
   * Writes the running search now, for helper edits that Configure rather
   * than InstantSearch searches with, which report no state change. Returns
   * the history mode it used, or null if the URL already holds the search.
   */
  writeSearch(): "push" | "replace" | null;
  /** Checkpoints a submit of the search a live preview already wrote. */
  submitShown(): void;
}

const SearchUrlContext = createContext<SearchUrlOwner | null>(null);

export function useSearchUrl(): SearchUrlOwner {
  const owner = useContext(SearchUrlContext);
  if (!owner)
    throw new Error(
      "useSearchUrl() ran outside SearchUrlProvider. Render the search inside SearchAccessShell, which owns the /search URL.",
    );
  return owner;
}

export function SearchUrlProvider({
  owner,
  children,
}: {
  owner: SearchUrlOwner;
  children: ReactNode;
}) {
  return <SearchUrlContext value={owner}>{children}</SearchUrlContext>;
}

function indexState(uiState: UiState): IndexUiState {
  return uiState[ALGOLIA_INDEX_NAME] ?? {};
}

function vinFilter(policy: SearchUrlPolicy, url: SearchUrl) {
  return policy.vinPatternIndexReady && !url.expression
    ? getSearchableVinPattern(url.query ?? null)?.filter
    : undefined;
}

/**
 * nuqs owns the /search URL and InstantSearch is controlled. Search changes
 * reach `onStateChange`, which writes them through nuqs and applies them.
 * URL changes nobody here wrote (Back, Forward, a link) reach InstantSearch
 * through `SearchUrlSync`, and only when they change the search.
 */
export function useSearchUrlOwner({
  policy,
  knownYardNames,
  routedOptions,
}: {
  policy: SearchUrlPolicy;
  knownYardNames: readonly string[];
  /**
   * Every input that changes how the URL maps to a search. A remount that
   * changes them searches; one for a new key or client alone does not.
   */
  routedOptions: string;
}) {
  const router = useRouter();
  const [queuedValues, setValues] = useQueryStates(SearchUrl.parsers, {
    urlKeys: SearchUrl.urlKeys,
    // A deep write would render the server page again for every refinement.
    shallow: true,
  });
  const pending = useRef<Promise<unknown> | null>(null);
  // nuqs keeps serving a flushed write until its next write or its popstate
  // listener, which runs after Next renders Back or Forward. So once our
  // writes land, read the URL itself, which Back, Forward and our writes
  // update first. A navigation Next starts (a link, router.push) is the
  // other way round: it renders the new URL, and the server props for it,
  // before it writes the URL as it commits. So when only Next's URL moved
  // since the last commit, read Next's.
  const routerSearch = useSearchParams().toString();
  const committed = useRef<{ router: string; location: string } | null>(null);
  useLayoutEffect(() => {
    committed.current = {
      router: routerSearch,
      location: window.location.search,
    };
  });
  const landedSearch =
    typeof window === "undefined" || pending.current
      ? null
      : committed.current &&
          committed.current.location === window.location.search &&
          committed.current.router !== routerSearch
        ? routerSearch
        : window.location.search;
  const landedValues = useMemo(
    () =>
      landedSearch === null
        ? null
        : SearchUrl.load(new URLSearchParams(landedSearch)),
    [landedSearch],
  );
  const values = landedValues ?? queuedValues;
  const yardsKey = JSON.stringify(knownYardNames);
  const yards = useMemo(() => knownYardNames, [yardsKey]);
  const url = useMemo(
    () => SearchUrl.fromValues(values, yards),
    [values, yards],
  );
  const initialUiState: UiState = {
    [ALGOLIA_INDEX_NAME]: SearchUrlUiState.toUiState(url, policy),
  };

  // What callbacks from InstantSearch and the page read: the latest render's
  // inputs, and the URL's values once every write queued since lands. nuqs
  // puts a queued write in `values` at once, so each render catches up.
  const rendered = useRef({ policy, yards, url });
  rendered.current = { policy, yards, url };
  const written = useRef(values);
  const renderedValues = useRef(values);
  if (renderedValues.current !== values) {
    renderedValues.current = values;
    written.current = values;
  }
  // The `q` the next search write starts from (see setNextQuery).
  const nextQuery = useRef<{ q: string | null } | null>(null);
  const instance = useRef<InstantSearchInstance | null>(null);
  // A VIN switch searches once Configure filters by the new VIN.
  const deferred = useRef<IndexUiState | null>(null);
  const syncing = useRef(false);
  const leaving = useRef(false);
  /**
   * The page a link left from, once its navigation starts. Writes resume
   * when Next commits any other URL, even one holding the same search.
   */
  const leftFrom = useRef<string | null>(null);
  const searchedOptions = useRef<string | null>(null);
  /**
   * Whether a search instance that just mounted must search. Server results
   * need none, and neither does a remount for the same routed options.
   */
  const searchesOnMount = useCallback(
    (hydrated: boolean) => {
      const first = searchedOptions.current !== routedOptions;
      searchedOptions.current = routedOptions;
      return first && !hydrated;
    },
    [routedOptions],
  );

  const current = useCallback(
    () => SearchUrl.fromValues(written.current, rendered.current.yards),
    [],
  );
  const send = useCallback(
    (write: SearchUrlWrite, history: SearchHistoryWrite) => {
      written.current = SearchUrl.merge(written.current, write);
      const previous = "previous" in history ? history.previous : null;
      const sent = setValues(write, {
        history: history.history,
        // Runs as nuqs flushes, just before it pushes the submitted search:
        // live previews replaced the entry from before typing.
        startTransition: previous
          ? (flush) => {
              window.history.replaceState(window.history.state, "", previous);
              flush();
            }
          : undefined,
      });
      pending.current = sent;
      void sent.finally(() => {
        if (pending.current === sent) pending.current = null;
      });
      return sent;
    },
    [setValues],
  );

  /**
   * Writes `uiState` as the search URL: the history mode it used, or null if
   * the URL already holds it, and whether the VIN that Configure filters by
   * changes, so the search must wait for it.
   */
  const writeUiState = useCallback(
    (
      uiState: IndexUiState,
      checkpoint?: SearchHistoryWrite,
    ): { history: "push" | "replace" | null; waitsForVin: boolean } => {
      const { policy, yards } = rendered.current;
      const before = current();
      const override = nextQuery.current;
      nextQuery.current = null;
      const base = override
        ? SearchUrl.fromValues(
            SearchUrl.merge(written.current, override),
            yards,
          )
        : before;
      const { url: next, locked } = SearchUrlUiState.fromUiState(
        uiState,
        policy,
        base,
      );
      const nextKey = SearchUrl.format("", next);
      if (
        (nextKey === SearchUrl.format("", before) && !checkpoint) ||
        leaving.current
      )
        return { history: null, waitsForVin: false };
      const isWritten = (href: string) =>
        SearchUrlKey.of(href, yards) === nextKey;
      const history =
        checkpoint ??
        (syncing.current
          ? { history: "replace" as const }
          : SearchInputHistory.write({
              onlyQuery:
                SearchUrlUiState.typingKey(next, policy) ===
                SearchUrlUiState.typingKey(before, policy),
              sameResults:
                SearchUrlUiState.searchKey(next, policy) ===
                SearchUrlUiState.searchKey(before, policy),
              isWritten,
            }));
      const write = SearchUrl.writeValues(next, locked);
      // The window, radius and origin are written only by writeArea.
      for (const key of AREA_KEYS) delete write[key];
      void send(write, history);
      return {
        history: history.history,
        waitsForVin:
          vinFilter(policy, next) !== vinFilter(policy, rendered.current.url),
      };
    },
    [current, send],
  );

  const onStateChange = useCallback(
    ({
      uiState,
      setUiState,
    }: {
      uiState: UiState;
      setUiState: (uiState: UiState) => void;
    }) => {
      const { waitsForVin } = writeUiState(indexState(uiState));
      if (waitsForVin && !syncing.current) {
        deferred.current = indexState(uiState);
        return;
      }
      setUiState(uiState);
    },
    [writeUiState],
  );

  const owner = useMemo<SearchUrlOwner>(
    () => ({
      values,
      writeArea: async (area, history) => {
        if (leaving.current) return;
        await send(
          area,
          history === "push" ? { history: "push" } : { history: "replace" },
        );
      },
      setNextQuery: (q) => {
        nextQuery.current = { q };
      },
      writeSearch: () => {
        const search = instance.current;
        return search
          ? writeUiState(indexState(search.getUiState())).history
          : null;
      },
      submitShown: () => {
        const search = instance.current;
        const shown = SearchUrl.format("", current());
        const checkpoint = SearchInputHistory.submitShown(
          (href) => SearchUrlKey.of(href, rendered.current.yards) === shown,
        );
        if (search && checkpoint?.history === "push")
          writeUiState(indexState(search.getUiState()), checkpoint);
      },
    }),
    [current, send, values, writeUiState],
  );

  // Next cancels a navigation in flight when a history write it did not
  // make lands, and every nuqs write is one. A click on a link that leaves
  // the page stops writes, and lets a queued one land before navigating.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !link ||
        !YardMapUrl.leavesPage(
          event,
          {
            href: link.href,
            target: link.target,
            download: link.hasAttribute("download"),
          },
          window.location.href,
        )
      )
        return;
      leaving.current = true;
      const queued = pending.current;
      if (!queued || new URL(link.href).origin !== window.location.origin) {
        leftFrom.current = window.location.href;
        return;
      }
      event.preventDefault();
      // Until the queued write lands, the URL changing is not the link's.
      leftFrom.current = null;
      void queued.finally(() => {
        // Back or Forward since the click cancels the link, as it would
        // have cancelled Next's navigation.
        if (!leaving.current) return;
        leftFrom.current = window.location.href;
        router.push(link.href);
      });
    };
    const stopLeaving = () => {
      leaving.current = false;
      leftFrom.current = null;
    };
    const onPageShow = (event: PageTransitionEvent) => {
      // Restored from the back-forward cache, the page is no longer leaving.
      if (event.persisted) stopLeaving();
    };
    // Capture runs before Next.js's link handler starts the navigation.
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", stopLeaving);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", stopLeaving);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [router]);
  // Next writes the URL as a navigation commits, before layout effects run.
  // A link that kept the search (one dropping a campaign tag, say) changes
  // nothing SearchUrlSync applies, so the navigation ends here.
  useLayoutEffect(() => {
    if (
      leaving.current &&
      leftFrom.current !== null &&
      window.location.href !== leftFrom.current
    ) {
      leaving.current = false;
      leftFrom.current = null;
    }
  });

  return {
    owner,
    initialUiState,
    onStateChange,
    searchesOnMount,
    sync: { policy, url, current, instance, deferred, syncing, leaving },
  };
}

/** Same for URLs that hold the same search, whatever their order or encoding. */
const SearchUrlKey = {
  of(href: string, knownYardNames: readonly string[]): string | null {
    try {
      return SearchUrl.format(
        "",
        SearchUrl.parse(new URL(href).searchParams, knownYardNames),
      );
    } catch {
      return null;
    }
  },
} as const;

type SearchUrlSyncState = ReturnType<typeof useSearchUrlOwner>["sync"];

/**
 * Inside InstantSearch: applies URL changes nobody here wrote, such as Back
 * and Forward, and a VIN switch once Configure has its filter. A layout
 * effect, so the search it starts joins the one that Configure's update in
 * the same commit schedules.
 */
export function SearchUrlSync({ state }: { state: SearchUrlSyncState }) {
  const search = useInstantSearchContext();
  const urlKey = SearchUrl.format("", state.url);
  const seen = useRef(urlKey);
  useLayoutEffect(() => {
    state.instance.current = search;
    return () => {
      if (state.instance.current === search) state.instance.current = null;
    };
  }, [search, state.instance]);
  useLayoutEffect(() => {
    const changed = seen.current !== urlKey;
    seen.current = urlKey;
    if (!search.started) return;
    const { policy } = state;
    const apply = (uiState: IndexUiState) => {
      state.syncing.current = true;
      try {
        search.setUiState((previous) => ({
          ...previous,
          [ALGOLIA_INDEX_NAME]: uiState,
        }));
      } finally {
        state.syncing.current = false;
      }
    };
    const deferred = state.deferred.current;
    if (
      deferred &&
      vinFilter(policy, state.url) === vinFilter(policy, state.current())
    ) {
      state.deferred.current = null;
      apply(deferred);
      return;
    }
    if (!changed) return;
    // Our own writes are already running. Anything else (Back, Forward, a
    // link to another search) is applied, which also ends a navigation that
    // stopped writes.
    const target = SearchUrlUiState.toUiState(state.url, policy);
    if (
      SearchUrlUiState.searchedKey(target, policy, state.url) ===
      SearchUrlUiState.searchedKey(
        indexState(search.getUiState()),
        policy,
        state.url,
      )
    )
      return;
    state.leaving.current = false;
    apply(target);
  });
  return null;
}
