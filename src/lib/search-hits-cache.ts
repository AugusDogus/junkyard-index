import type { InfiniteHitsCache } from "instantsearch.js/es/connectors/infinite-hits/connectInfiniteHits";

function create<Hit extends NonNullable<object>>(): InfiniteHitsCache<Hit> {
  type Entry = Parameters<InfiniteHitsCache<Hit>["write"]>[0];
  const entries = new Map<string, Entry["hits"]>();
  const key = (state: Entry["state"]) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(state)
          .filter(([name]) => name !== "page")
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    );
  return {
    read: ({ state }) => entries.get(key(state)) ?? null,
    write: ({ state, hits }) => {
      const stateKey = key(state);
      entries.delete(stateKey);
      entries.set(stateKey, hits);
      // Keep sort histories without retaining every query typed in a long session.
      if (entries.size > 16) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
    },
  };
}

export const SearchHitsCache = { create } as const;
