import { createHash } from "node:crypto";
import { z } from "zod";
import { inventoryHtmlAttribute } from "./inventory-html";
import { chazClass, chazDivs, chazDocument, chazText } from "./chaz-html";
import { chazImage } from "./chaz-transform";
import {
  CHAZ_IMAGE_PREFIX,
  CHAZ_ORIGIN,
  CHAZ_YARD,
  chazBrowsePath,
} from "./chaz-yard-metadata";

export const chazHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const ChazControlSchema = z
  .object({
    path: z.string().min(1).max(300),
    label: z.string().min(1).max(100),
    count: z.number().int().min(0).max(10_000),
  })
  .strict();
export type ChazControl = z.infer<typeof ChazControlSchema>;

// Raw native identity values, compacted without inferred VIN or URL metadata.
export const ChazRecordSchema = z.tuple([
  z.string().max(100), // VIN or older serial
  z.string().max(30), // labelled year
  z.string().max(200), // combined native make/model
  z.string().max(100), // optional labelled stock
  z.string().max(1000), // literal native donor destination
  z.string().max(1500).nullable(), // primary image reference
  z.string().max(100).nullable(), // labelled Enter Date
]);
export type ChazRecord = z.infer<typeof ChazRecordSchema>;
export const ChazPageSchema = z
  .object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    records: z.array(ChazRecordSchema).max(1000),
  })
  .strict();
export type ChazPage = z.infer<typeof ChazPageSchema>;

function terminal(html: string) {
  for (const match of html.matchAll(
    /(<(?:a|button)\b[^>]*>)([\s\S]*?)<\/(?:a|button)>/gi,
  )) {
    const tag = match[1] ?? "";
    if (
      /paginat|page-link|load.?more/i.test(
        inventoryHtmlAttribute(tag, "class") ?? "",
      ) ||
      /^(?:next|prev)$/i.test(inventoryHtmlAttribute(tag, "rel") ?? "") ||
      /^(?:next(?: page)?|previous(?: page)?|load more|show more)$/i.test(
        chazText(match[2] ?? ""),
      )
    )
      throw new Error(
        "Chaz native continuation changed; inspect the published browse graph",
      );
  }
}

function inventory(raw: string): string {
  const owners = [...raw.matchAll(/\bvar\s+urgid\s*=\s*(['"])(.*?)\1\s*;/g)];
  if (owners.length === 0 || owners.some((owner) => owner[2] !== "MD08"))
    throw new Error(
      "Chaz native inventory supplier MD08 is missing or changed",
    );
  const html = chazDocument(raw);
  terminal(html);
  return html;
}

function browseRegion(html: string): string {
  const regions = chazDivs(
    html,
    "iiscont",
    (tag) => inventoryHtmlAttribute(tag, "id") === "iiscont",
  );
  if (regions.length !== 1 || !regions[0])
    throw new Error("Chaz expected one complete native browse region");
  return regions[0].body;
}

export function parseChazDirectory(
  raw: string,
  kind: "makes" | "models",
  parent?: ChazControl,
): ChazControl[] {
  const html = browseRegion(inventory(raw));
  if (kind === "makes" && chazDivs(html, "iisMakesMenu").length !== 1)
    throw new Error("Chaz native make directory is missing or ambiguous");
  const controls: ChazControl[] = [];
  for (const match of html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)) {
    const tag = match[1] ?? "";
    if (!chazClass(tag, "iis-center-block")) continue;
    const body = match[2] ?? "";
    const badges = [
      ...body.matchAll(/(<span\b[^>]*>)([\s\S]*?)<\/span>/gi),
    ].filter((m) => chazClass(m[1] ?? "", "badge"));
    const badge = badges[0];
    const count = chazText(badge?.[2] ?? "");
    const label = chazText(badge ? body.replace(badge[0], "") : body);
    const path = chazBrowsePath(
      chazText(inventoryHtmlAttribute(tag, "href") ?? ""),
      kind === "makes" ? 1 : 2,
    );
    if (
      !path ||
      badges.length !== 1 ||
      !/^\d+$/.test(count) ||
      (parent && !path.startsWith(parent.path.replace(/\/$/, "") + "/"))
    )
      throw new Error(
        "Chaz published directory path, badge or parent binding changed",
      );
    controls.push(
      ChazControlSchema.parse({ path, label, count: Number(count) }),
    );
  }
  if (
    controls.length === 0 ||
    controls.length > (kind === "makes" ? 64 : 128) ||
    new Set(controls.map((c) => c.path)).size !== controls.length
  )
    throw new Error(
      "Chaz directory is empty, oversized or repeats a native destination",
    );
  return controls;
}

function cards(
  html: string,
  allowEmpty: boolean,
  context?: { make: ChazControl; model: ChazControl },
): ChazPage {
  const blocks = chazDivs(html, "card-price");
  const empty =
    /<h3\b[^>]*>\s*No Results Found\. Try Browsing Our Parts Or Search Again\s*<\/h3>/i.test(
      html,
    );
  if (blocks.length === 0) {
    if (allowEmpty && empty) return { records: [], hash: chazHash([]) };
    throw new Error(
      "Chaz native donor cards are missing without an explicit empty result",
    );
  }
  if (empty || blocks.length > 1000 || chazDivs(html, "card-deck").length !== 1)
    throw new Error(
      "Chaz native donor region is contradictory, oversized or ambiguous",
    );
  const records = blocks.map(({ body }): ChazRecord => {
    const details = chazDivs(body, "car-details");
    if (details.length !== 1)
      throw new Error(
        "Chaz donor card lacks one complete labelled identity region",
      );
    const fields = new Map<string, string>();
    for (const match of (details[0]?.body ?? "").matchAll(
      /<b\b[^>]*>([\s\S]*?)<\/b\s*>([\s\S]*?)<br\s*\/?\s*>/gi,
    )) {
      const key = chazText(match[1] ?? "")
        .replace(/\s*:\s*$/, "")
        .toLowerCase();
      if (fields.has(key))
        throw new Error("Repeated Chaz donor card field " + key);
      fields.set(key, chazText(match[2] ?? ""));
    }
    const stock = fields.get("stock") ?? "";
    const year = fields.get("year") ?? "";
    const title = fields.get("make/model") ?? "";
    const vin = fields.get("vin") ?? "";
    const anchors = [...body.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)].filter(
      (m) => /^See Parts\b/.test(chazText(m[2] ?? "")),
    );
    if (anchors.length !== 1)
      throw new Error("Chaz donor card lacks one native See Parts destination");
    const destination = URL.parse(
      chazText(inventoryHtmlAttribute(anchors[0]?.[1] ?? "", "href") ?? ""),
      CHAZ_ORIGIN,
    );
    if (
      context &&
      destination?.pathname.split("/").slice(0, -2).join("/") !==
        context.model.path.replace(/\/$/, "")
    )
      throw new Error(
        "Chaz returned donor destination belongs to another published model",
      );
    const assertions = [...body.matchAll(/<button\b[^>]*>/gi)].flatMap(
      ([tag]) => {
        const value = inventoryHtmlAttribute(tag, "data-vehicle");
        return value === null ? [] : [chazText(value)];
      },
    );
    const identities = new Set([chazText(`${year} ${title} - VIN ${vin}`)]);
    if (
      context &&
      title.startsWith(context.make.label + " ") &&
      context.model.label === title
    )
      identities.add(
        chazText(
          `${year} ${context.make.label} ${context.model.label} - VIN ${vin}`,
        ),
      );
    else if (!context) {
      // Recent inquiry labels sometimes repeat a literal leading brand already
      // present in the card title. Accept repetition, never different YMM text.
      const words = title.split(" ");
      for (let length = 1; length < words.length; length++)
        identities.add(
          chazText(
            `${year} ${words.slice(0, length).join(" ")} ${title} - VIN ${vin}`,
          ),
        );
    }
    if (
      assertions.length === 0 ||
      assertions.some((value) => !identities.has(value))
    )
      throw new Error(
        "Chaz same-card inquiry for stock " +
          stock +
          " contradicts or lacks its native year, make/model or VIN assertion",
      );
    // Only the primary card image is metadata. Hidden recent-arrival galleries
    // contain distinct photographs and are not contradictory primary images.
    const imageBlock = chazDivs(body, "card-img")[0]?.body ?? "";
    const primary = [...imageBlock.matchAll(/<img\b[^>]*>/gi)][0]?.[0];
    const imageValue = primary
      ? (inventoryHtmlAttribute(primary, "data-src") ??
        inventoryHtmlAttribute(primary, "src"))
      : null;
    const image = chazImage(
      imageValue === null ? null : chazText(imageValue),
      stock,
    );
    return ChazRecordSchema.parse([
      vin,
      year,
      title,
      stock,
      destination?.origin === CHAZ_ORIGIN
        ? destination.href.slice(CHAZ_ORIGIN.length)
        : (destination?.href ?? ""),
      image?.startsWith(CHAZ_IMAGE_PREFIX)
        ? image.slice(CHAZ_IMAGE_PREFIX.length)
        : null,
      fields.get("enter date") || null,
    ]);
  });
  return { records, hash: chazHash(records) };
}

export function parseChazModel(
  raw: string,
  make: ChazControl,
  model: ChazControl,
): ChazPage {
  const document = inventory(raw);
  const html = browseRegion(document);
  if (!model.path.startsWith(make.path.replace(/\/$/, "") + "/"))
    throw new Error("Chaz model control is outside its published make");
  const page = cards(html, true, { make, model });
  if (page.records.length === 0) {
    const headings = [
      ...document.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi),
    ].map((match) => chazText(match[1] ?? ""));
    const expected = new Set([`Used ${make.label} ${model.label}`]);
    if (model.label.startsWith(make.label + " "))
      expected.add(`Used ${model.label}`);
    // This captured empty model has an independently published display variant.
    // It binds the page only and never supplies canonical vehicle metadata.
    if (model.path === "/parts/CHRYSLER/TOWN_-and_COUNTRY/")
      expected.add("Used CHRYSLER TOWN -and COUNTRY");
    if (!headings.some((heading) => expected.has(heading)))
      throw new Error(
        "Chaz explicit empty result belongs to another published model",
      );
  }
  if (
    page.records.length > 0 &&
    !chazText(html).includes(
      "Some vehicles may not show parts available if we haven't parted them out yet.",
    )
  )
    throw new Error("Chaz donor and awaiting-partout scope changed");
  return page;
}

export function parseChazRoot(raw: string): ChazPage {
  const html = inventory(raw);
  const titles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)];
  if (
    titles.length !== 1 ||
    chazText(titles[0]?.[1] ?? "") !== "Recent Arrivals - " + CHAZ_YARD.name
  )
    throw new Error("Chaz native recent-arrival surface is missing");
  return cards(html, false);
}

export function parseChazContact(raw: string): string {
  const html = chazDocument(raw);
  const text = chazText(html);
  const phone = [...html.matchAll(/<a\b[^>]*>/gi)].some(
    ([tag]) =>
      inventoryHtmlAttribute(tag, "href")?.replace(/[^\d]/g, "") ===
      "4108767815",
  );
  const map = [...html.matchAll(/<iframe\b[^>]*>/gi)].some(([tag]) => {
    const url = URL.parse(chazText(inventoryHtmlAttribute(tag, "src") ?? ""));
    return (
      url?.origin === "https://www.google.com" &&
      url.pathname === "/maps/embed" &&
      url.searchParams
        .get("pb")
        ?.includes("Chaz's Used Auto Parts & Towing Inc")
    );
  });
  if (!text.includes("Taneytown, MD 21787") || !phone || !map)
    throw new Error(
      "Chaz official physical address, phone or named-business map changed",
    );
  return chazHash([
    "6035 Taneytown Pike",
    "Taneytown",
    "MD",
    "21787",
    "410-876-7815",
  ]);
}
