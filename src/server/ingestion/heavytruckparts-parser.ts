import { z } from "zod";
import { inventoryHtmlAttribute } from "./inventory-html";
import {
  heavyTruckPartsAnchors,
  heavyTruckPartsDivs,
  heavyTruckPartsText,
} from "./heavytruckparts-html";

/** Exact supplier/store/category controls, shared by the two HTP yards. */
export interface HeavyTruckPartsSupplier {
  supplier: string;
  itemCategory: "Complete-Vehicle" | "Vehicle-For-Sale";
  title: "Complete Vehicle" | "Vehicle For Sale";
  location: string;
  attributes: "vin-only" | "vehicle-specs";
}
export function heavyTruckPartsParser(config: HeavyTruckPartsSupplier) {
  function itemId(raw: string): string | null {
    return (
      new RegExp(
        `^https://www\\.heavytruckparts\\.net/item/[A-Za-z0-9%()_-]+/[A-Za-z0-9%()_-]+/${config.itemCategory}/${config.supplier}/1/([1-9]\\d{0,9})$`,
      ).exec(raw)?.[1] ?? null
    );
  }
  function boundImage(raw: string, id: string): boolean {
    return new RegExp(
      `^https://webp\\.heavytruckparts\\.net/image/[A-Za-z0-9%()_-]+_${config.itemCategory}_${config.supplier}_1_${id}_1\\.webp$`,
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
      imageUrl: z.string().max(2000).nullable(),
      engine: z.string().max(300).nullable().optional(),
      transmission: z.string().max(300).nullable().optional(),
    })
    .strict()
    .refine(
      (r) =>
        itemId(r.url) === r.id &&
        (r.imageUrl === null || boundImage(r.imageUrl, r.id)) &&
        (config.attributes !== "vin-only" ||
          (!Object.hasOwn(r, "engine") && !Object.hasOwn(r, "transmission"))),
      "HeavyTruckParts native item or photo join changed",
    );
  function cards(region: string): HeavyTruckPartsRecord[] {
    const records = heavyTruckPartsDivs(region, "product").map(
      (card): HeavyTruckPartsRecord => {
        const destinations = new Set(
          heavyTruckPartsAnchors(card)
            .filter((a) => a.href.includes("/item/"))
            .map((a) => a.href),
        );
        const path = [...destinations][0] ?? "",
          url = "https://www.heavytruckparts.net" + path;
        const id = itemId(url);
        if (
          destinations.size !== 1 ||
          !path.startsWith("/item/") ||
          id === null
        )
          throw new Error(
            "HeavyTruckParts card has a foreign owner/category or conflicting destination",
          );
        const headings = [...card.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
        const title = heavyTruckPartsText(headings[0]?.[1] ?? "");
        const year = /^(\d{4}) /.exec(title)?.[1] ?? "";
        const controls = [...card.matchAll(/<button\b[^>]*>/gi)].flatMap(
          ([tag]) => {
            const call = inventoryHtmlAttribute(tag, "onclick");
            return call?.startsWith("create_estimate(")
              ? [heavyTruckPartsText(call)]
              : [];
          },
        );
        const claim = new RegExp(
          `^create_estimate\\(${config.supplier}, (\\d+), 1, 9000, '([^']*)', '([^']*)', 'empty'\\)$`,
        ).exec(controls[0] ?? "");
        const make = claim?.[2]?.trim() ?? "",
          model = claim?.[3]?.trim() ?? "";
        if (
          headings.length !== 1 ||
          controls.length !== 1 ||
          claim?.[1] !== id ||
          title !== `${year} ${make} ${model} ${config.title}`
        )
          throw new Error(
            "HeavyTruckParts native title, item ID and make/model control do not join",
          );
        const attrs = [
          ...card.matchAll(/(<span\b[^>]*>)([\s\S]*?)<\/span>/gi),
        ].filter(
          (m) => inventoryHtmlAttribute(m[1] ?? "", "class") === "prod-attrib",
        );
        const attrValues = attrs.map((m) => heavyTruckPartsText(m[2] ?? ""));
        const vins = attrValues.filter((value) => value.startsWith("VIN #:"));
        if (
          vins.length !== 1 ||
          (config.attributes === "vin-only" && attrs.length !== 1)
        )
          throw new Error(
            "HeavyTruckParts native VIN field is missing or ambiguous",
          );
        const attrText = vins[0] ?? "";
        function specification(label: string): string | null {
          const values = attrValues.filter((value) =>
            value.startsWith(label + ":"),
          );
          if (values.length > 1)
            throw new Error("HeavyTruckParts repeated " + label + " attribute");
          return values[0]?.slice(label.length + 1).trim() || null;
        }
        const paragraphs = [
          ...card.matchAll(/(<p\b[^>]*>)([\s\S]*?)<\/p>/gi),
        ].map((p) => ({
          tag: p[1] ?? "",
          text: heavyTruckPartsText(p[2] ?? ""),
        }));
        if (config.attributes === "vehicle-specs") {
          const prices = paragraphs.filter(
            (p) => inventoryHtmlAttribute(p.tag, "class") === "product-price",
          );
          if (prices.length !== 1 || prices[0]?.text !== "Please Call")
            throw new Error(
              "HeavyTruckParts vehicle price scope changed; review donor eligibility",
            );
        }
        const location = paragraphs.filter(
          (p) => inventoryHtmlAttribute(p.tag, "class") === "location",
        );
        if (location.length !== 1 || location[0]?.text !== config.location)
          throw new Error(
            "HeavyTruckParts card physical owner or geography changed",
          );
        const description = paragraphs
          .filter(
            (p) =>
              inventoryHtmlAttribute(p.tag, "class") === null &&
              !p.text.startsWith("VIN #:") &&
              (config.attributes === "vin-only" ||
                !attrValues.includes(p.text)),
          )
          .map((p) => p.text)
          .filter(Boolean)
          .join(" ");
        const image = [...card.matchAll(/<img\b[^>]*>/gi)][0]?.[0] ?? "";
        const imageUrl = inventoryHtmlAttribute(image, "src");
        const acceptedImage =
          imageUrl && boundImage(imageUrl, id) ? imageUrl : null;
        return recordSchema.parse({
          id,
          url,
          year,
          make,
          model,
          vin: attrText.slice("VIN #:".length).trim(),
          description,
          imageUrl: acceptedImage,
          ...(config.attributes === "vehicle-specs"
            ? {
                engine: specification("Engine"),
                transmission: specification("Transmission"),
              }
            : {}),
        });
      },
    );
    return records;
  }
  return { itemId, recordSchema, cards };
}
export type HeavyTruckPartsRecord = z.infer<
  ReturnType<typeof heavyTruckPartsParser>["recordSchema"]
>;
