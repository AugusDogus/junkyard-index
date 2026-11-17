import { z } from "zod";
import { prattText } from "./pratt-html";
import { shopifyYardDocument, shopifyYardImage } from "./shopify-yard-html";
import { ShopifyYardDonorSchema } from "./shopify-yard-cursor";
import { CARSANDPARTS_ORIGIN } from "./carsandparts-yard-metadata";

export function parseCarsandpartsOwner(raw: string) {
  const text = prattText(shopifyYardDocument(raw));
  if (
    !text.includes("CarsAndPartsHub") ||
    !text.includes(
      "Every part we sell came off one of these cars, dismantled by hand in Lumberton, NJ.",
    ) ||
    !text.includes("donor cars")
  )
    throw new Error(
      "CarsAndPartsHub donor collection or Lumberton yard attribution changed",
    );
}

const product = z.object({
  id: z.number().int().positive(),
  handle: z
    .string()
    .regex(/^vehicle-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/),
  tags: z.array(z.string().max(300)).max(200),
  variants: z
    .array(z.object({ available: z.boolean() }))
    .min(1)
    .max(100),
  images: z
    .array(z.object({ src: z.string().url() }))
    .max(100)
    .nullish()
    .transform((images) => images ?? []),
});

export function parseCarsandpartsInventory(raw: string) {
  if (Buffer.byteLength(raw) > 4 * 1024 * 1024)
    throw new Error("CarsAndPartsHub collection exceeds 4 MiB");
  const data = z
    .object({ products: z.array(product).min(1).max(249) })
    .parse(JSON.parse(raw));
  // Shopify's limit=250 collection API terminates on a short page. A full
  // page needs a newly qualified pagination contract, never a partial snapshot.
  if (
    new Set(data.products.map((row) => row.id)).size !== data.products.length ||
    new Set(data.products.map((row) => row.handle)).size !==
      data.products.length ||
    data.products.some((row) => !row.tags.includes("type_VEHICLE"))
  )
    throw new Error(
      "CarsAndPartsHub unique donor collection membership changed",
    );
  return data.products.map((row) => {
    const reasons: string[] = [];
    const field = (prefix: string, required = false) => {
      const values = row.tags
        .filter((tag) => tag.startsWith(prefix))
        .map((tag) => tag.slice(prefix.length).trim());
      if (required && (values.length !== 1 || !values[0]))
        reasons.push("missing-or-conflicting-" + prefix);
      return values.length === 1 ? (values[0] ?? "") : "";
    };
    const vin = field("vin_", true);
    // year_* tags describe part fitment ranges, not the donor's year.
    const years = row.tags.flatMap((tag) => {
      const match = /^veh_production_year_(\d{4})$/.exec(tag);
      return match?.[1] ? [match[1]] : [];
    });
    const year = years.length === 1 ? (years[0] ?? "") : "";
    if (!year) reasons.push("missing-or-conflicting-production-year");
    const make = field("make_", true);
    const model = field("model_", true);
    for (const [prefix, value] of [
      ["veh_make_", make],
      ["veh_model_", model],
    ] as const) {
      const secondary = field(prefix);
      if (secondary && secondary.toLowerCase() !== value.toLowerCase())
        reasons.push("conflicting-" + prefix);
    }
    return ShopifyYardDonorSchema.parse({
      id: String(row.id),
      vin,
      year,
      make,
      model,
      status: row.variants.some((variant) => variant.available)
        ? "active"
        : "excluded",
      reasons,
      detailsUrl:
        CARSANDPARTS_ORIGIN + "/products/" + row.handle + "?view=donor",
      stockNumber: field("stock_id_") || null,
      color: field("veh_exterior_color_") || null,
      imageUrl: shopifyYardImage(row.images[0]?.src ?? null, [
        "cdn.shopify.com",
      ]),
    });
  });
}
