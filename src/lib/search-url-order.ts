/**
 * The /search URL keys in the order `SearchUrl.format` writes them. Kept free
 * of the search modules, since every app route's nuqs adapter imports it.
 */
const KEYS = [
  "arrivalWindow",
  "arrivalWindow[]",
  "lat",
  "lng",
  "radius",
  "q",
  "syntax",
  "makes",
  "makes[]",
  "colors",
  "colors[]",
  "states",
  "states[]",
  "yards",
  "yards[]",
  "sources",
  "sources[]",
  "minYear",
  "maxYear",
  "yardTypes",
  "yardTypes[]",
  "sort",
] as const;

/**
 * `params` with /search keys in `KEYS` order and any other key after them
 * as it was. nuqs moves each list it writes to the end, so its adapter runs
 * this on every write to keep one order.
 */
function apply(params: URLSearchParams): URLSearchParams {
  const known: readonly string[] = KEYS;
  const ordered = new URLSearchParams();
  for (const key of KEYS)
    for (const value of params.getAll(key)) ordered.append(key, value);
  for (const [key, value] of params)
    if (!known.includes(key)) ordered.append(key, value);
  return ordered;
}

export const SearchUrlOrder = { keys: KEYS, apply } as const;
