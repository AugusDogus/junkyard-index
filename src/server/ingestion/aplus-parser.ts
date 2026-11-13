import { createHash } from "node:crypto";
import { z } from "zod";
import { inventoryHtmlAttribute } from "./inventory-html";
import { aplusClass, aplusDivs, aplusDocument, aplusText } from "./aplus-html";
import { aplusImage } from "./aplus-transform";
import {
  APLUS_IMAGE_PREFIX,
  APLUS_ORIGIN,
  APLUS_YARD,
  aplusBrowsePath,
} from "./aplus-yard-metadata";

export const aplusHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const AplusControlSchema = z
  .object({
    path: z.string().min(1).max(300),
    label: z.string().min(1).max(100),
    count: z.number().int().min(0).max(10_000),
  })
  .strict();
export type AplusControl = z.infer<typeof AplusControlSchema>;

// Raw native identity values, compacted without inferred VIN or URL metadata.
export const AplusRecordSchema = z.tuple([
  z.string().max(100), // VIN or older serial
  z.string().max(30), // labelled year
  z.string().max(200), // combined native make/model
  z.string().max(100), // optional labelled stock
  z.string().max(1000), // literal native donor destination
  z.string().max(1500).nullable(), // primary image reference
  z.string().max(100).nullable(), // labelled Enter Date
]);
export type AplusRecord = z.infer<typeof AplusRecordSchema>;
export const AplusPageSchema = z
  .object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    records: z.array(AplusRecordSchema).max(1000),
  })
  .strict();
export type AplusPage = z.infer<typeof AplusPageSchema>;

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
      /(?:[?&](?:page|paged|p|offset|start)=\d+|\/page\/\d+(?:[/?#]|$))/i.test(
        aplusText(inventoryHtmlAttribute(tag, "href") ?? ""),
      ) ||
      /^(?:next(?: page)?|previous(?: page)?|load more|show more)$/i.test(
        aplusText(match[2] ?? ""),
      )
    )
      throw new Error(
        "Aplus native continuation changed; inspect the published browse graph",
      );
  }
}

function inventory(raw: string): string {
  const owners = [...raw.matchAll(/\bvar\s+urgid\s*=\s*(['"])(.*?)\1\s*;/g)];
  if (owners.length === 0 || owners.some((owner) => owner[2] !== "QQ91"))
    throw new Error(
      "Aplus native inventory supplier QQ91 is missing or changed",
    );
  const html = aplusDocument(raw);
  terminal(html);
  return html;
}

function browseRegion(html: string): string {
  const regions = aplusDivs(
    html,
    "iiscont",
    (tag) => inventoryHtmlAttribute(tag, "id") === "iiscont",
  );
  if (regions.length !== 1 || !regions[0])
    throw new Error("Aplus expected one complete native browse region");
  return regions[0].body;
}

export function parseAplusDirectory(
  raw: string,
  kind: "makes" | "models",
  parent?: AplusControl,
): AplusControl[] {
  const html = browseRegion(inventory(raw));
  if (kind === "makes" && aplusDivs(html, "iisMakesMenu").length !== 1)
    throw new Error("Aplus native make directory is missing or ambiguous");
  const controls: AplusControl[] = [];
  for (const match of html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)) {
    const tag = match[1] ?? "";
    if (!aplusClass(tag, "iis-center-block")) continue;
    const body = match[2] ?? "";
    const badges = [
      ...body.matchAll(/(<span\b[^>]*>)([\s\S]*?)<\/span>/gi),
    ].filter((m) => aplusClass(m[1] ?? "", "badge"));
    const badge = badges[0];
    const count = aplusText(badge?.[2] ?? "");
    const label = aplusText(badge ? body.replace(badge[0], "") : body);
    const path = aplusBrowsePath(
      aplusText(inventoryHtmlAttribute(tag, "href") ?? ""),
      kind === "makes" ? 1 : 2,
    );
    if (
      !path ||
      badges.length !== 1 ||
      !/^\d+$/.test(count) ||
      (parent && !path.startsWith(parent.path.replace(/\/$/, "") + "/"))
    )
      throw new Error(
        "Aplus published directory path, badge or parent binding changed",
      );
    controls.push(
      AplusControlSchema.parse({ path, label, count: Number(count) }),
    );
  }
  if (
    controls.length === 0 ||
    controls.length > (kind === "makes" ? 64 : 128) ||
    new Set(controls.map((c) => c.path)).size !== controls.length
  )
    throw new Error(
      "Aplus directory is empty, oversized or repeats a native destination",
    );
  return controls;
}

function cards(
  html: string,
  allowEmpty: boolean,
  context?: { make: AplusControl; model: AplusControl },
): AplusPage {
  const blocks = aplusDivs(html, "card-price");
  const empty =
    /<h3\b[^>]*>\s*No Results Found\. Try Browsing Our Parts Or Search Again\s*<\/h3>/i.test(
      html,
    );
  if (blocks.length === 0) {
    if (allowEmpty && empty) return { records: [], hash: aplusHash([]) };
    throw new Error(
      "Aplus native donor cards are missing without an explicit empty result",
    );
  }
  if (
    empty ||
    blocks.length > 1000 ||
    aplusDivs(html, "card-deck").length !== 1
  )
    throw new Error(
      "Aplus native donor region is contradictory, oversized or ambiguous",
    );
  const records = blocks.map(({ body }): AplusRecord => {
    const details = aplusDivs(body, "car-details");
    if (details.length !== 1)
      throw new Error(
        "Aplus donor card lacks one complete labelled identity region",
      );
    const fields = new Map<string, string>();
    const repeated = new Set<string>();
    for (const match of (details[0]?.body ?? "").matchAll(
      /<b\b[^>]*>([\s\S]*?)<\/b\s*>([\s\S]*?)<br\s*\/?\s*>/gi,
    )) {
      const key = aplusText(match[1] ?? "")
        .replace(/\s*:\s*$/, "")
        .toLowerCase();
      const value = aplusText(match[2] ?? "");
      if (fields.has(key)) {
        repeated.add(key);
        if (
          ["year", "make/model", "vin"].includes(key) &&
          fields.get(key) !== value
        )
          throw new Error(
            "Conflicting required A Plus donor card field " + key,
          );
      } else fields.set(key, value);
    }
    const rawStock = fields.get("stock") ?? "";
    const stock =
      repeated.has("stock") || rawStock.length > 100 ? "" : rawStock;
    const year = fields.get("year") ?? "";
    const title = fields.get("make/model") ?? "";
    const vin = fields.get("vin") ?? "";
    const anchors = [...body.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)].filter(
      (m) => /^See Parts\b/.test(aplusText(m[2] ?? "")),
    );
    if (anchors.length !== 1)
      throw new Error(
        "Aplus donor card lacks one native See Parts destination",
      );
    const destination = URL.parse(
      aplusText(inventoryHtmlAttribute(anchors[0]?.[1] ?? "", "href") ?? ""),
      APLUS_ORIGIN,
    );
    if (
      context &&
      destination?.pathname.split("/").slice(0, -2).join("/") !==
        context.model.path.replace(/\/$/, "")
    )
      throw new Error(
        "Aplus returned donor destination belongs to another published model",
      );
    const assertions = [...body.matchAll(/<button\b[^>]*>/gi)].flatMap(
      ([tag]) => {
        const value = inventoryHtmlAttribute(tag, "data-vehicle");
        return value === null ? [] : [aplusText(value)];
      },
    );
    const identities = new Set([aplusText(`${year} ${title} - VIN ${vin}`)]);
    if (
      context &&
      title.startsWith(context.make.label + " ") &&
      context.model.label === title
    )
      identities.add(
        aplusText(
          `${year} ${context.make.label} ${context.model.label} - VIN ${vin}`,
        ),
      );
    else if (!context) {
      // Recent inquiry labels sometimes repeat a literal leading brand already
      // present in the card title. Accept repetition, never different YMM text.
      const words = title.split(" ");
      for (let length = 1; length < words.length; length++)
        identities.add(
          aplusText(
            `${year} ${words.slice(0, length).join(" ")} ${title} - VIN ${vin}`,
          ),
        );
    }
    if (
      assertions.length === 0 ||
      assertions.some((value) => !identities.has(value))
    )
      throw new Error(
        "Aplus same-card inquiry for stock " +
          stock +
          " contradicts or lacks its native year, make/model or VIN assertion",
      );
    // Only the primary card image is metadata. Hidden recent-arrival galleries
    // contain distinct photographs and are not contradictory primary images.
    const imageBlock = aplusDivs(body, "card-img")[0]?.body ?? "";
    const primary = [...imageBlock.matchAll(/<img\b[^>]*>/gi)][0]?.[0];
    let imageValue: string | null = null;
    if (primary) {
      try {
        imageValue =
          inventoryHtmlAttribute(primary, "data-src") ??
          inventoryHtmlAttribute(primary, "src");
      } catch {
        // Ambiguous optional image attributes supply no usable metadata.
      }
    }
    const image = aplusImage(
      imageValue === null ? null : aplusText(imageValue),
      stock,
    );
    return AplusRecordSchema.parse([
      vin,
      year,
      title,
      stock,
      destination?.origin === APLUS_ORIGIN
        ? destination.href.slice(APLUS_ORIGIN.length)
        : (destination?.href ?? ""),
      image?.startsWith(APLUS_IMAGE_PREFIX)
        ? image.slice(APLUS_IMAGE_PREFIX.length)
        : null,
      repeated.has("enter date") ||
      (fields.get("enter date")?.length ?? 0) > 100
        ? null
        : fields.get("enter date") || null,
    ]);
  });
  return { records, hash: aplusHash(records) };
}

export function parseAplusModel(
  raw: string,
  make: AplusControl,
  model: AplusControl,
): AplusPage {
  const document = inventory(raw);
  const html = browseRegion(document);
  if (!model.path.startsWith(make.path.replace(/\/$/, "") + "/"))
    throw new Error("Aplus model control is outside its published make");
  const page = cards(html, true, { make, model });
  if (page.records.length === 0) {
    const headings = [
      ...document.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi),
    ].map((match) => aplusText(match[1] ?? ""));
    const expected = new Set([
      `Used ${make.label} ${model.label} Parts`.toLowerCase(),
    ]);
    if (model.label.startsWith(make.label + " "))
      expected.add(`Used ${model.label} Parts`.toLowerCase());
    if (!headings.some((heading) => expected.has(heading.toLowerCase())))
      throw new Error(
        "Aplus explicit empty result belongs to another published model",
      );
  }
  if (
    page.records.length > 0 &&
    !aplusText(html)
      .replace(/’/g, "'")
      .includes(
        "Some vehicles may not show parts available if we haven't parted them out yet.",
      )
  )
    throw new Error("Aplus donor and awaiting-partout scope changed");
  return page;
}

export function parseAplusRoot(raw: string): AplusPage {
  const html = inventory(raw);
  const titles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)];
  if (
    titles.length !== 1 ||
    aplusText(titles[0]?.[1] ?? "") !== "Latest Arrivals | " + APLUS_YARD.name
  )
    throw new Error("Aplus native latest-arrival surface is missing");
  return cards(html, false);
}

/** Ownership is verified on the observed official homepage. Native alternate
 * phone numbers remain valid observations without requiring surface equality. */
export function parseAplusContact(raw: string): string {
  const html = aplusDocument(raw);
  const text = aplusText(html);
  if (!text.includes("Nicholasville, KY 40356"))
    throw new Error(
      "A Plus official physical address changed; inspect the native homepage before resuming",
    );
  return aplusHash([
    APLUS_YARD.name,
    APLUS_YARD.address,
    APLUS_YARD.city,
    APLUS_YARD.state,
    APLUS_YARD.postalCode,
  ]);
}
