import { z } from "zod";

/** Exact supplier/store/category controls, shared by the HTP sources. */
export interface HeavyTruckPartsSupplier {
  supplier: string;
  itemCategory: string;
  store?: string;
  title: string;
  location: string;
  attributes: "vin-only" | "vehicle-specs" | "marketplace";
}
export function heavyTruckPartsRecord(config: HeavyTruckPartsSupplier) {
  const store = config.store ?? "1";
  if (
    !/^\d+$/.test(config.supplier) ||
    !/^[1-9]\d*$/.test(store) ||
    !/^[A-Za-z0-9-]+$/.test(config.itemCategory)
  )
    throw new Error("HeavyTruckParts supplier configuration is invalid");
  const query =
    config.attributes === "marketplace"
      ? "(?:\\?oemnum=(?:\\*|[A-Za-z0-9%._-]+))?"
      : "";
  function itemId(raw: string): string | null {
    return (
      new RegExp(
        `^https://www\\.heavytruckparts\\.net/item/[A-Za-z0-9%()_-]+/[A-Za-z0-9%()_-]+/${config.itemCategory}/${config.supplier}/${store}/([1-9]\\d{0,9})${query}$`,
      ).exec(raw)?.[1] ?? null
    );
  }
  function boundImage(raw: string, id: string): boolean {
    return new RegExp(
      `^https://webp\\.heavytruckparts\\.net/image/[A-Za-z0-9%()_-]+_${config.itemCategory}_${config.supplier}_${store}_${id}_1\\.webp$`,
      "i",
    ).test(raw);
  }
  const recordSchema = z
    .object({
      id: z.string().regex(/^[1-9]\d{0,9}$/),
      url: z
        .string()
        .max(1000)
        .refine((url) => itemId(url) !== null),
      year: z.string().max(10),
      make: z.string().max(200),
      model: z.string().max(300),
      vin: z.string().max(100),
      description: z.string().max(2000),
      price: z.string().max(100).optional(),
      imageUrl: z.string().max(2000).nullable(),
      engine: z.string().max(300).nullable().optional(),
      transmission: z.string().max(300).nullable().optional(),
    })
    .strict()
    .refine(
      (r) =>
        itemId(r.url) === r.id &&
        (config.attributes === "marketplace"
          ? typeof r.price === "string" &&
            /^(?:Please Call|\$[\d,]+\.\d{2})$/.test(r.price)
          : r.price === undefined) &&
        (r.imageUrl === null || boundImage(r.imageUrl, r.id)) &&
        (config.attributes !== "vin-only" ||
          (!Object.hasOwn(r, "engine") && !Object.hasOwn(r, "transmission"))),
      "HeavyTruckParts native item or photo join changed",
    );
  return { itemId, boundImage, recordSchema };
}
export type HeavyTruckPartsRecord = z.infer<
  ReturnType<typeof heavyTruckPartsRecord>["recordSchema"]
>;
