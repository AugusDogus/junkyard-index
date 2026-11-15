import { z } from "zod";
import { prattText } from "./pratt-html";
import { shopifyYardDocument, shopifyYardImage } from "./shopify-yard-html";
import { ShopifyYardDonorSchema } from "./shopify-yard-cursor";
import { MODERNMUSCLE_ORIGIN } from "./modernmuscle-yard-metadata";

export function parseModernmuscleOwner(raw: string) {
  const text = prattText(shopifyYardDocument(raw));
  if (
    !text.includes("Contact Modern Muscle Salvage") ||
    !text.includes("15980 32 Mile Rd Ray, MI 48096")
  )
    throw new Error(
      "Modern Muscle Salvage physical Ray address changed or disappeared",
    );
}
// Zod strips all unlisted properties before claims reach checkpoints or output.
// Never include parts, business costs, purchase data, revenue, or profitability.
const vehicle = z.object({
  stock_number: z.string().min(1).max(100),
  year: z.number().int().nullable(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  vin: z.string().nullable(),
  color: z.string().nullable(),
  image_urls: z.array(z.string().url()).max(100),
  availability_state: z.enum([
    "available",
    "new_arrival",
    "not_online",
    "sold_out",
  ]),
  list_visible: z.boolean(),
});
const feed = z.object({
  schema_version: z.literal(1),
  vehicle_count: z.number().int().min(1).max(2000),
  listed_vehicle_count: z.number().int().min(0),
  vehicles: z.array(vehicle).min(1).max(2000),
});
export function parseModernmuscleInventory(raw: string) {
  if (Buffer.byteLength(raw) > 8 * 1024 * 1024)
    throw new Error("Modern Muscle feed exceeds 8 MiB");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(
      "Modern Muscle feed is not complete JSON; no raw feed data retained",
    );
  }
  const continuation = z
    .object({
      next: z.unknown().optional(),
      next_page: z.unknown().optional(),
      has_more: z.unknown().optional(),
      pagination: z.unknown().optional(),
    })
    .parse(value);
  if (
    Object.values(continuation).some(
      (v) => v !== undefined && v !== null && v !== false,
    )
  )
    throw new Error("Modern Muscle introduced unverified pagination controls");
  const data = feed.parse(value);
  if (
    data.vehicle_count !== data.vehicles.length ||
    data.listed_vehicle_count !==
      data.vehicles.filter((v) => v.list_visible).length ||
    new Set(data.vehicles.map((v) => v.stock_number)).size !==
      data.vehicles.length
  )
    throw new Error(
      "Modern Muscle complete donor count, visibility count or unique stock frontier changed",
    );
  return data.vehicles.map((v) =>
    ShopifyYardDonorSchema.parse({
      id: v.stock_number,
      vin: v.vin ?? "",
      year: String(v.year ?? ""),
      make: v.make ?? "",
      model: v.model ?? "",
      status:
        v.list_visible &&
        (v.availability_state === "available" ||
          v.availability_state === "new_arrival")
          ? "active"
          : "excluded",
      reasons: [],
      detailsUrl:
        MODERNMUSCLE_ORIGIN +
        "/pages/shop-by-vehicle?stock=" +
        encodeURIComponent(v.stock_number),
      imageUrl: shopifyYardImage(v.image_urls[0] ?? null, [
        "hooks.modernmusclesalvage.com",
      ]),
      color: v.color,
      stockNumber: v.stock_number,
    }),
  );
}
