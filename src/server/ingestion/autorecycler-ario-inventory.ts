import { z } from "zod";
import { ARIO_ORIGIN, type ArioClient } from "./autorecycler-ario-client";
import {
  AUTORECYCLER_LOOKUP_PREFIX,
  type ArioCustomerYard,
} from "./autorecycler-ario-yards";
import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
  normalizeRegion,
} from "./normalization";
import type { AutorecyclerOrgGeo } from "./autorecycler-transform";
import type { CanonicalVehicle } from "./types";

const itemSchema = z.object({
  id: z.string().min(1),
  yard: z.string(),
  yard_id: z.string().uuid(),
  item_rank: z.number().int().positive(),
  total_yard_inventory: z.number().int().nonnegative(),
  vin: z.string().nullish(),
  year: z.union([z.string(), z.number()]).nullish(),
  make: z.string().nullish(),
  model: z.string().nullish(),
  ario_make: z.string().nullish(),
  ario_model: z.string().nullish(),
  color: z.string().nullish(),
  stock: z.string().nullish(),
  row: z.string().nullish(),
  image_url: z.string().nullish(),
  date_placed: z.string().nullish(),
  ario_date_placed: z.string().nullish(),
  ario_date_removed: z.string().nullish(),
});
const pageSchema = z.object({
  error: z.never().optional(),
  items: z.array(itemSchema).max(100),
  total: z.number().int().nonnegative(),
  yards_meta: z
    .array(
      z.object({
        yard: z.string(),
        returned: z.number().int().nonnegative(),
        total_matching: z.number().int().nonnegative(),
        truncated: z.boolean(),
        next_offset: z.number().int().nonnegative(),
      }),
    )
    .max(1),
});
export type ArioItem = z.infer<typeof itemSchema>;

/** Rank windows are independent of returned count: removed rows leave holes.
 * Verify the closing count and first page before allowing reconciliation. */
export async function readArioYard(client: ArioClient, yard: ArioCustomerYard) {
  const items = new Map<string, ArioItem>();
  let total: number | undefined;
  let first: string | undefined;
  let pages = 0;
  for (let offset = 0; ; offset += 100) {
    if (offset > 100_000)
      throw new Error(
        `Ario ${yard.slug} exceeded the 100,000 rank safety bound`,
      );
    const page = pageSchema.parse(await client.page(yard.slug, offset));
    pages++;
    const meta = page.yards_meta[0];
    if (
      page.yards_meta.length !== 1 ||
      !meta ||
      meta.yard !== yard.slug ||
      meta.returned !== page.items.length ||
      meta.total_matching !== page.total ||
      (total !== undefined && page.items.length > 0 && total !== page.total)
    )
      throw new Error(
        `Ario ${yard.slug} returned missing or changing pagination evidence; retry the complete yard`,
      );
    total ??= page.total;
    let previousRank = offset;
    for (const item of page.items) {
      if (
        item.yard !== yard.slug ||
        item.yard_id !== yard.id ||
        item.item_rank <= previousRank ||
        item.item_rank > offset + 100 ||
        item.total_yard_inventory !== total ||
        items.has(item.id)
      )
        throw new Error(
          `Ario ${yard.slug} returned contradictory ownership, rank or duplicate item ${item.id}`,
        );
      previousRank = item.item_rank;
      items.set(item.id, item);
    }
    if (offset === 0) first = JSON.stringify(page.items);
    // total_matching includes rows suppressed by the public API. Visit every
    // rank window through that bound, even when a window is short or empty.
    if (offset + 100 >= total) break;
  }
  const closing = pageSchema.parse(await client.page(yard.slug, 0));
  pages++;
  if (closing.total !== total || JSON.stringify(closing.items) !== first)
    throw new Error(
      `Ario ${yard.slug} changed during enumeration; retry the complete yard`,
    );
  return { items: [...items.values()], pages, total: total ?? 0 };
}

export function arioDate(item: ArioItem): string | null {
  const date = item.ario_date_placed || item.date_placed;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date
    ? new Date(ms).toISOString()
    : null;
}

export function arioGeo(
  yard: ArioCustomerYard,
  name: string,
  lat: number,
  lng: number,
  address?: string | null,
): AutorecyclerOrgGeo {
  const region = normalizeRegion("", yard.state);
  return {
    orgLookup: `${AUTORECYCLER_LOOKUP_PREFIX}${yard.legacyId}`,
    locationName: name,
    locationCity: yard.city,
    ...region,
    lat,
    lng,
    ...(address ? { address } : {}),
  };
}

export function transformArioItem(
  item: ArioItem,
  geo: AutorecyclerOrgGeo,
): CanonicalVehicle | null {
  const year = Number(item.year);
  const vin = inventoryVin(item.vin ?? "", String(item.year ?? ""));
  const make = normalizeCanonicalMake(item.ario_make || item.make || "");
  const model = (item.ario_model || item.model || "").trim();
  if (
    !vin ||
    !Number.isInteger(year) ||
    year < 1886 ||
    year > 2100 ||
    !make ||
    !model
  )
    return null;
  return {
    vin,
    source: "autorecycler",
    year,
    make,
    model,
    color: normalizeCanonicalColor(item.color ?? ""),
    stockNumber: item.stock || null,
    imageUrl: item.image_url?.split(",")[0] || null,
    availableDate: arioDate(item),
    locationCode: geo.orgLookup,
    locationName: geo.locationName,
    locationCity: geo.locationCity,
    state: geo.state,
    stateAbbr: geo.stateAbbr,
    lat: geo.lat,
    lng: geo.lng,
    section: null,
    row: item.row || null,
    space: null,
    engine: null,
    trim: null,
    transmission: null,
    detailsUrl: `${ARIO_ORIGIN}/search?yard=${encodeURIComponent(item.yard)}&inv=${encodeURIComponent(item.id)}`,
    partsUrl: null,
    pricesUrl: null,
  };
}
