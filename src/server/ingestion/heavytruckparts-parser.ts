import { inventoryHtmlAttribute } from "./inventory-html";
import {
  heavyTruckPartsAnchors,
  heavyTruckPartsDivs,
  heavyTruckPartsText,
} from "./heavytruckparts-html";

import {
  heavyTruckPartsRecord,
  type HeavyTruckPartsRecord,
  type HeavyTruckPartsSupplier,
} from "./heavytruckparts-record";
export type { HeavyTruckPartsRecord } from "./heavytruckparts-record";
export function heavyTruckPartsParser(config: HeavyTruckPartsSupplier) {
  const store = config.store ?? "1";
  const { itemId, boundImage, recordSchema } = heavyTruckPartsRecord(config);
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
        const year =
          (config.attributes === "marketplace" ? /^(\d+) / : /^(\d{4}) /).exec(
            title,
          )?.[1] ?? "";
        const controls = [...card.matchAll(/<button\b[^>]*>/gi)].flatMap(
          ([tag]) => {
            const call = inventoryHtmlAttribute(tag, "onclick");
            return call?.startsWith("create_estimate(")
              ? [heavyTruckPartsText(call)]
              : [];
          },
        );
        const claim = new RegExp(
          `^create_estimate\\(${config.supplier}, (\\d+), ${store}, 9000, '([^']*)', '([^']*)', 'empty'\\)$`,
        ).exec(controls[0] ?? "");
        const make = claim?.[2]?.trim() ?? "",
          model = claim?.[3]?.trim() ?? "";
        if (
          headings.length !== 1 ||
          controls.length !== 1 ||
          claim?.[1] !== id ||
          title !==
            (config.attributes === "marketplace"
              ? heavyTruckPartsText(`${year} ${make} ${model} ${config.title}`)
              : `${year} ${make} ${model} ${config.title}`.trim())
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
          (config.attributes === "marketplace"
            ? vins.length > 1
            : vins.length !== 1) ||
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
          if (values.length > 1 && config.attributes === "marketplace")
            return null;
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
          ...(config.attributes === "marketplace"
            ? {
                price: paragraphs
                  .filter(
                    (p) =>
                      inventoryHtmlAttribute(p.tag, "class") ===
                      "product-price",
                  )
                  .map((p) => p.text)
                  .join(" "),
              }
            : {}),
          imageUrl: acceptedImage,
          ...(config.attributes !== "vin-only"
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
