import type {
  InfiniteHitsCache,
  InfiniteHitsCachedHits,
} from "instantsearch.js/es/connectors/infinite-hits/connectInfiniteHits";
import { z } from "zod";
import type { AlgoliaVehicleHit } from "./search-vehicles";

const storageKey = "junkyard-index:search-pages:v1";
const lifetime = 30 * 60_000;
const hitSchema = z
  .object({
    objectID: z.string(),
    __position: z.number(),
    __queryID: z.string().optional(),
    _geoloc: z.object({ lat: z.number(), lng: z.number() }).optional(),
  })
  .catchall(z.unknown());
const storedSchema = z
  .array(
    z.tuple([
      z.string(),
      z.object({
        savedAt: z.number(),
        hits: z.record(z.string().regex(/^\d+$/), z.array(hitSchema)),
      }),
    ]),
  )
  .max(16);
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function create() {
  type Entry = {
    savedAt: number;
    hits: InfiniteHitsCachedHits<AlgoliaVehicleHit>;
  };
  type State = Parameters<
    InfiniteHitsCache<AlgoliaVehicleHit>["read"]
  >[0]["state"];
  const entries = new Map<string, Entry>();
  let storage: Storage | undefined;
  let activeKey = "";
  const key = (state: State) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(state)
          .filter(([name]) => name !== "page")
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    );
  const persist = () => {
    // Storage is best effort. An unavailable/full tab store must not discard
    // the in-memory results or prevent the next search.
    try {
      storage?.setItem(storageKey, JSON.stringify([...entries]));
    } catch {
      /* Keep the in-memory cache. */
    }
  };
  return {
    read: ({ state }: { state: State }) => {
      activeKey = key(state);
      const entry = entries.get(activeKey);
      return entry && Date.now() - entry.savedAt < lifetime ? entry.hits : null;
    },
    write: ({ state, hits }: { state: State; hits: Entry["hits"] }) => {
      const stateKey = key(state);
      entries.delete(stateKey);
      entries.set(stateKey, { savedAt: Date.now(), hits });
      if (entries.size > 16) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
      persist();
    },
    restore(tabStorage: Storage) {
      storage = tabStorage;
      try {
        const parsed = storedSchema.safeParse(
          JSON.parse(storage.getItem(storageKey) ?? "null"),
        );
        if (parsed.success) {
          for (const [key, entry] of parsed.data) {
            if (Date.now() - entry.savedAt < lifetime) entries.set(key, entry);
          }
        }
      } catch {
        /* A missing/corrupt tab cache starts with the server's results. */
      }
      while (entries.size > 16) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
      persist();
    },
    activeKey: () => activeKey,
  } satisfies InfiniteHitsCache<AlgoliaVehicleHit> & {
    restore(storage: Storage): void;
    activeKey(): string;
  };
}

export const SearchHitsCache = { create } as const;
