import { z } from "zod";
import {
  OEM_ARRIVALS,
  OEM_MAKES,
  oemAssertNoContinuation,
  oemAttribute,
  oemClass,
  oemDocument,
  oemElements,
  oemOwnedUrl,
  oemRegion,
  oemText,
} from "./oem-html";

export const OemControlSchema = z
  .object({
    url: z.string(),
    label: z.string().min(1).max(200),
    count: z.number().int().nonnegative().safe(),
  })
  .strict();
export type OemControl = z.infer<typeof OemControlSchema>;
export type OemDirectoryContext =
  | { kind: "makes" }
  | { kind: "models"; make: OemControl };
export type OemDonorContext =
  | { kind: "arrivals" }
  | { kind: "model"; make: OemControl; model: OemControl };
export interface OemRecord {
  sourceUrl: string;
  context: OemDonorContext;
  ordinal: number;
  cardId: string | null;
  fields: { label: string; value: string }[];
  destinations: string[];
  images: string[];
}
export interface OemPage {
  sourceUrl: string;
  records: OemRecord[];
  nativeEmpty: boolean;
}
const donorContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("arrivals") }).strict(),
  z
    .object({
      kind: z.literal("model"),
      make: OemControlSchema,
      model: OemControlSchema,
    })
    .strict(),
]);
export const OemPageSchema = z
  .object({
    sourceUrl: z.string().max(1000),
    nativeEmpty: z.boolean(),
    records: z
      .array(
        z
          .object({
            sourceUrl: z.string().max(1000),
            context: donorContextSchema,
            ordinal: z.number().int().nonnegative(),
            cardId: z.string().max(200).nullable(),
            fields: z
              .array(
                z
                  .object({
                    label: z.string().max(200),
                    value: z.string().max(1000),
                  })
                  .strict(),
              )
              .max(32),
            destinations: z.array(z.string().max(1000)).length(1),
            images: z.array(z.string().max(2000)).max(200),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict()
  .refine((page) => page.nativeEmpty === (page.records.length === 0));
const markers = (html: string, name: string) =>
  [...html.matchAll(/<[a-z][\w-]*\b[^>]*>/gi)].filter(([tag]) =>
    oemClass(tag, name),
  ).length;
export function oemControlUrl(control: OemControl, depth: 2 | 3): string {
  OemControlSchema.parse(control);
  const url = oemOwnedUrl(control.url);
  const path = url?.pathname.replace(/\/$/, "");
  if (
    !url ||
    !path ||
    path.split("/").length !== depth + 1 ||
    !/^\/parts\/[^/]+(?:\/[^/]+)?$/.test(path)
  )
    throw new Error("OEM directory control is outside its native owned parent");
  return url.href;
}
export function parseOemDirectory(
  raw: string,
  context: OemDirectoryContext,
): OemControl[] {
  const source =
    context.kind === "makes" ? OEM_MAKES : oemControlUrl(context.make, 2);
  const html = oemDocument(raw, source);
  oemAssertNoContinuation(html);
  if (markers(html, "car-details"))
    throw new Error("OEM menu gained unclassified donor records");
  const region = oemRegion(html, (tag) =>
    context.kind === "makes"
      ? oemClass(tag, "iisMakesMenu")
      : oemAttribute(tag, "id") === "menumodellist",
  );
  const controls = oemElements(region, "a").map(({ tag, body }) => {
    const badges = oemElements(body, "span", (tag) => oemClass(tag, "badge"));
    const count = oemText(badges[0]?.body ?? "");
    const label = oemText(
      body.replace(/<span\b[^>]*>[\s\S]*?<\/span\s*>/gi, ""),
    );
    const url = oemAttribute(tag, "href") ?? "";
    if (badges.length !== 1 || !/^\d+$/.test(count))
      throw new Error(
        "OEM directory label/count changed; no native control was omitted",
      );
    const control = OemControlSchema.parse({
      url,
      label,
      count: Number(count),
    });
    const resolved = oemControlUrl(control, context.kind === "makes" ? 2 : 3);
    if (
      context.kind === "models" &&
      !resolved.startsWith(
        oemControlUrl(context.make, 2).replace(/\/$/, "") + "/",
      )
    )
      throw new Error(
        "OEM model control disagrees with its published make parent",
      );
    return { ...control, url: resolved };
  });
  if (
    !controls.length ||
    controls.length > 1000 ||
    new Set(controls.map((c) => c.url.replace(/\/$/, ""))).size !==
      controls.length
  )
    throw new Error(
      "OEM directory is empty, oversized or repeats a native control",
    );
  return controls;
}
export function parseOemDonors(raw: string, context: OemDonorContext): OemPage {
  const sourceUrl =
    context.kind === "arrivals"
      ? OEM_ARRIVALS
      : oemControlUrl(context.model, 3);
  if (
    context.kind === "model" &&
    !sourceUrl.startsWith(
      oemControlUrl(context.make, 2).replace(/\/$/, "") + "/",
    )
  )
    throw new Error("OEM donor page disagrees with its published make parent");
  const html = oemDocument(raw, sourceUrl);
  oemAssertNoContinuation(html);
  const cards = oemElements(html, "div", (tag) => oemClass(tag, "card-price"));
  const emptyAlerts = oemElements(
    html,
    "div",
    (tag) =>
      oemClass(tag, "alert-warning") && oemAttribute(tag, "role") === "alert",
  );
  const nativeEmpty =
    !cards.length &&
    emptyAlerts.length === 1 &&
    /^No Results Found\. Try Browsing Our Parts Or Search Again$/.test(
      oemText(emptyAlerts[0]?.body ?? ""),
    );
  if (
    (!cards.length && !nativeEmpty) ||
    (cards.length > 0 &&
      emptyAlerts.some((alert) =>
        /^No Results Found\. Try Browsing Our Parts Or Search Again$/.test(
          oemText(alert.body),
        ),
      )) ||
    cards.length > 10000 ||
    markers(html, "card-price") !== cards.length ||
    markers(html, "car-details") !== cards.length
  )
    throw new Error(
      "OEM donor cards and identity regions do not reconcile; no empty result was inferred",
    );
  const records = cards.map((card, ordinal): OemRecord => {
    const details = oemRegion(card.body, (tag) => oemClass(tag, "car-details"));
    const fields = [
      ...details.matchAll(/<b\b[^>]*>([\s\S]*?)<\/b\s*>([\s\S]*?)(?=<b\b|$)/gi),
    ].map((match) => ({
      label: oemText(match[1] ?? "")
        .replace(/\s*:\s*$/, "")
        .trim()
        .toLowerCase(),
      value: oemText(match[2] ?? ""),
    }));
    if (fields.length !== [...details.matchAll(/<b\b/gi)].length)
      throw new Error("OEM donor labels are truncated or unclassified");
    const links = oemElements(card.body, "a").filter(
      (link) => oemText(link.body) === "See Parts",
    );
    if (links.length !== 1)
      throw new Error("OEM donor lost its single native destination");
    const destination = oemOwnedUrl(
      oemAttribute(links[0]?.tag ?? "", "href") ?? "",
      sourceUrl,
    );
    if (
      !destination ||
      !/^\/parts\/[^/]+\/[^/]+\/[^/]+\/\d{4}$/.test(destination.pathname)
    )
      throw new Error("OEM donor destination is missing, foreign or malformed");
    const images = [...card.body.matchAll(/<img\b[^>]*>/gi)].flatMap(
      ([tag]) => {
        const image = oemAttribute(tag, "data-src") ?? oemAttribute(tag, "src");
        return image ? [image] : [];
      },
    );
    return {
      sourceUrl,
      context,
      ordinal,
      cardId: oemAttribute(card.tag, "id"),
      fields,
      destinations: [destination.href],
      images: [...new Set(images)],
    };
  });
  if (context.kind === "arrivals") {
    // The published count span omits </span> before its enclosing </div>.
    // Accept that exact numeric boundary without repairing donor card markup.
    const counts = [
      ...html.matchAll(
        /<span\b([^>]*)>\s*(\d+)\s*(?:<\/span\s*>\s*)?<\/div\s*>/gi,
      ),
    ].filter((m) => oemAttribute(m[1] ?? "", "id") === "vehicleCount");
    if (counts.length !== 1 || counts[0]?.[2] !== String(records.length))
      throw new Error(
        "OEM arrivals count disagrees with the complete native donor cards",
      );
  }
  return { sourceUrl, records, nativeEmpty };
}
