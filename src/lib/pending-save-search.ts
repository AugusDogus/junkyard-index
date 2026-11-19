import { z } from "zod";
import { filtersSchema } from "~/lib/saved-search-filters";
import { buildSearchUrl } from "~/lib/search-utils";
import { ReturnTo } from "~/lib/return-to";

const key = "pendingSaveSearch";
const schema = z.object({ query: z.string(), filters: filtersSchema });
export type PendingSaveSearch = z.infer<typeof schema>;

function store(query: string, filters: PendingSaveSearch["filters"]): void {
  sessionStorage.setItem(key, JSON.stringify({ query, filters }));
}

function read(): PendingSaveSearch | null {
  try {
    const stored = sessionStorage.getItem(key);
    if (!stored) return null;
    const parsed = schema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function clear(): void {
  sessionStorage.removeItem(key);
}

function checkoutReturnTo(pending: PendingSaveSearch): ReturnTo {
  const url = new URL(
    buildSearchUrl(pending.query, pending.filters),
    "https://return-to.invalid",
  );
  url.searchParams.set("saveSearch", "1");
  url.searchParams.set("subscription", "success");
  return ReturnTo.parse(url.pathname + url.search);
}

export const PendingSaveSearch = {
  store,
  read,
  clear,
  checkoutReturnTo,
} as const;
