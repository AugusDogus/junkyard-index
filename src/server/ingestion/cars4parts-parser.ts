import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CARS4PARTS_ORIGIN,
  cars4partsAttribute,
  cars4partsClass,
  cars4partsDocument,
  cars4partsElements,
  cars4partsFragment,
  cars4partsLeafUrl,
  cars4partsOne,
  cars4partsText,
} from "./cars4parts-html";
import { Cars4PartsRecordSchema } from "./cars4parts-record";
import { Cars4PartsResult } from "./cars4parts-result";

export const cars4partsHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const Cars4PartsRowSchema = z
  .object({
    destination: z.string().max(1000),
    ymm: z.string().max(500),
    branch: z.string().max(200),
    roleLabel: z.string().max(200).nullable(),
    narrative: z.string().max(10_000),
    stock: z.string().max(1000).nullable(),
    image: z.string().max(1000).nullable(),
  })
  .strict();
export type Cars4PartsRow = z.infer<typeof Cars4PartsRowSchema>;
export const Cars4PartsPageSchema = z
  .object({
    page: z.number().int().min(1).max(200),
    pages: z.array(z.number().int().min(1).max(200)).min(1).max(200),
    rows: z.array(Cars4PartsRowSchema).min(1).max(200),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type Cars4PartsPage = z.infer<typeof Cars4PartsPageSchema>;

export function parseCars4PartsInventory(raw: string) {
  return Cars4PartsResult.boundary("native inventory controls", () => {
    const html = cars4partsDocument(raw);
    const form = cars4partsOne(html, "form", (tag) =>
      cars4partsClass(tag, "advSearch"),
    );
    if (cars4partsAttribute(form.tag, "data-domain") !== CARS4PARTS_ORIGIN)
      throw new Error("Native search origin is missing or changed");
    const switches = [...form.body.matchAll(/<input\b[^>]*>/gi)]
      .map((match) => match[0])
      .filter((tag) => cars4partsAttribute(tag, "name") === "cps_use_ajax");
    if (
      switches.length !== 1 ||
      cars4partsAttribute(switches[0] ?? "", "value") !== "1"
    )
      throw new Error(
        "Native AJAX enablement control is missing or conflicting",
      );
    const select = cars4partsOne(
      form.body,
      "select",
      (tag) => cars4partsAttribute(tag, "id") === "makemodel",
    );
    const makes = cars4partsElements(select.body, "option").flatMap(
      (option) => {
        const value = cars4partsAttribute(option.tag, "value");
        if (value === "") return [];
        if (!value || value !== cars4partsText(option.body))
          throw new Error(
            "Native make option value and label are missing or disagree",
          );
        return [value];
      },
    );
    if (
      !makes.length ||
      makes.length > 256 ||
      new Set(makes).size !== makes.length
    )
      throw new Error(
        "Native make boundaries are empty, oversized or duplicated",
      );
    return { makes, hash: cars4partsHash(makes) };
  });
}

function labelled(raw: string, tag: "strong" | "p") {
  const fields = new Map<string, string[]>();
  for (const item of cars4partsElements(raw, "li")) {
    const labels = cars4partsElements(item.body, tag);
    if (!labels.length) continue;
    if (labels.length !== 1)
      throw new Error("Native labelled field has multiple labels");
    const label = cars4partsText(labels[0]?.body ?? "");
    const text = cars4partsText(item.body);
    if (!text.startsWith(label) || !label.endsWith(":"))
      throw new Error("Native field label boundary changed");
    const key = label.slice(0, -1).trim().toLowerCase();
    fields.set(key, [
      ...(fields.get(key) ?? []),
      text.slice(label.length).trim(),
    ]);
  }
  return fields;
}

/** These are actual donor-local label spans, not freeform compatibility or
 * decoder prose. Decorative delimiter dashes surround source field values. */
function proseFields(raw: string) {
  const fields = new Map<string, string[]>();
  const text = cars4partsText(raw).split(/\bShop by Make:/i)[0] ?? "";
  const labels = [
    ...text.matchAll(
      /\b(Year|Make|Model|VIN|Stock|Exterior color|Color|Miles|Body|Trim|Engine|Transmission|Drivetrain|Key|Title Condition|Seller|Located at Google Maps \/ Driving Directions|Phone|Price|Vehicle Condition \/ Dealer Notes)\s*:/gi,
    ),
  ].filter((match) => !/Engine\s+$/i.test(text.slice(0, match.index)));
  labels.forEach((match, index) => {
    const key = (match[1] ?? "").toLowerCase();
    if (!/^(?:year|make|model|vin|stock|exterior color|color)$/.test(key))
      return;
    const value = text
      .slice(
        match.index + match[0].length,
        labels[index + 1]?.index ?? text.length,
      )
      .replace(/^[\s\u2013\u2014-]+|[\s\u2013\u2014-]+$/g, "");
    // A labelled VIN remains a token even when the author puts subsequent prose
    // outside the inline style span. Every other valid overview VIN is retained.
    fields.set(key, [
      ...(fields.get(key) ?? []),
      key === "vin" ? (value.split(/\s/)[0] ?? "") : value,
    ]);
  });
  for (const table of cars4partsElements(raw, "table")) {
    for (const row of cars4partsElements(table.body, "tr")) {
      const cells = [
        ...row.body.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)\s*>/gi),
      ].map((match) => cars4partsText(match[1] ?? ""));
      const label = cells[0]?.toLowerCase();
      const key =
        label === "model year" ? "year" : label === "series" ? "model" : label;
      if (cells.length === 2 && key && /^(?:year|make|model|vin)$/.test(key))
        fields.set(key, [...(fields.get(key) ?? []), cells[1] ?? ""]);
    }
  }
  for (const cell of cars4partsElements(raw, "td")) {
    const labels = cars4partsElements(cell.body, "strong", (tag) =>
      cars4partsClass(tag, "line-item-title"),
    );
    const values = cars4partsElements(cell.body, "span", (tag) =>
      cars4partsClass(tag, "line-item-text"),
    );
    const label = cars4partsText(labels[0]?.body ?? "").toLowerCase();
    const key =
      label === "model year" ? "year" : label === "series" ? "model" : label;
    if (
      labels.length === 1 &&
      values.length === 1 &&
      /^(?:year|make|model|vin)$/.test(key)
    )
      fields.set(key, [
        ...(fields.get(key) ?? []),
        cars4partsText(values[0]?.body ?? ""),
      ]);
  }
  for (const match of text.matchAll(
    /\bVIN(?:\s+NUMBERS?)?\s*:?\s*([A-HJ-NPR-Z0-9]{17})\b/gi,
  ))
    fields.set("vin", [...(fields.get("vin") ?? []), match[1] ?? ""]);
  return fields;
}

export function parseCars4PartsLeaf(raw: string, destination: string) {
  return Cars4PartsResult.boundary("native donor detail " + destination, () => {
    if (cars4partsLeafUrl(destination) !== destination)
      throw new Error(
        "Detail destination is outside the exact owned inventory leaf graph",
      );
    const html = cars4partsDocument(raw);
    const overview = cars4partsOne(
      html,
      "div",
      (tag) => cars4partsAttribute(tag, "id") === "overview",
    ).body;
    const headings = cars4partsElements(overview, "h1").map((item) =>
      cars4partsText(item.body),
    );
    if (!headings.length)
      throw new Error("Native structured vehicle heading is missing");
    const below = cars4partsOne(html, "div", (tag) =>
      cars4partsClass(tag, "below_make"),
    ).body;
    const quick = cars4partsOne(html, "ul", (tag) =>
      cars4partsClass(tag, "quick-list"),
    ).body;
    const fields = labelled(below, "strong"),
      glance = labelled(quick, "p"),
      prose = proseFields(overview);
    const narrative = cars4partsText(overview);
    const values = (key: string) => [
      ...(fields.get(key) ?? []),
      ...(glance.get(key) ?? []),
    ];
    const canonicalClaims = [
      ...html.matchAll(/<(?:link|meta)\b[^>]*>/gi),
    ].flatMap(([tag]) =>
      cars4partsAttribute(tag, "rel") === "canonical"
        ? [cars4partsAttribute(tag, "href") ?? ""]
        : cars4partsAttribute(tag, "property") === "og:url"
          ? [cars4partsAttribute(tag, "content") ?? ""]
          : [],
    );
    return Cars4PartsRecordSchema.parse({
      destination,
      canonicalClaims,
      titles: headings.slice(0, 1),
      headings: headings.slice(1),
      branches: [
        cars4partsText(cars4partsElements(quick, "li")[0]?.body ?? ""),
      ],
      vins: [
        ...values("vin"),
        ...(prose.get("vin") ?? []),
        ...[...narrative.matchAll(/\b[A-HJ-NPR-Z0-9]{17}\b/gi)].map(
          (match) => match[0],
        ),
      ],
      proseFields: {
        year: prose.get("year") ?? [],
        make: prose.get("make") ?? [],
        model: prose.get("model") ?? [],
        vin: prose.get("vin") ?? [],
      },
      narrative,
      stock: [
        ...values("stock #"),
        ...values("stock"),
        ...(prose.get("stock") ?? []),
      ],
      colors: [
        ...values("exterior color"),
        ...(prose.get("exterior color") ?? []),
        ...(prose.get("color") ?? []),
      ],
      images: [...below.matchAll(/<img\b[^>]*>/gi)].flatMap(([tag]) => {
        const src = cars4partsAttribute(tag, "src");
        return src === null ? [] : [src];
      }),
    });
  });
}

export function parseCars4PartsResults(raw: string, page: number) {
  return Cars4PartsResult.boundary("native result page " + page, () => {
    const html = cars4partsFragment(raw);
    cars4partsOne(html, "div", (tag) => cars4partsClass(tag, "top-single-bar"));
    const results = cars4partsOne(html, "div", (tag) =>
      cars4partsClass(tag, "hideOnSearch"),
    ).body;
    for (const [tag] of html.matchAll(/<(?:a|button|input|div)\b[^>]*>/gi)) {
      if (
        ["data-next-page", "data-next-url", "data-next-cursor"].some(
          (key) => cars4partsAttribute(tag, key) !== null,
        ) ||
        /load.?more|page-numbers/i.test(
          cars4partsAttribute(tag, "class") ?? "",
        ) ||
        /\b(?:next|prev|last)\b/i.test(cars4partsAttribute(tag, "rel") ?? "")
      )
        throw new Error(
          "Unclassified native continuation is unread; inspect its literal source controls before emission",
        );
    }
    const paging = cars4partsOne(results, "p", (tag) =>
      cars4partsClass(tag, "paging"),
    ).body;
    const pages = cars4partsElements(paging, "a").map((item) => {
      const href = cars4partsAttribute(item.tag, "href") ?? "";
      const match = /^javascript:manual_hashchange\((["'])(.*?)\1\)$/.exec(
        href,
      );
      const hash = match?.[2] ? decodeURIComponent(match[2]) : "";
      const number = /^#search\/page-([1-9]\d*)\/$/.exec(hash)?.[1];
      if (!number || cars4partsText(item.body) !== number)
        throw new Error(
          "Published native pager control changed; no synthetic continuation is allowed",
        );
      return Number(number);
    });
    if (
      !pages.length ||
      pages.length > 200 ||
      pages.some((value, index) => value !== index + 1) ||
      !pages.includes(page)
    )
      throw new Error(
        "Published native pager is not a complete contiguous finite graph",
      );
    const blocks = cars4partsElements(results, "div", (tag) =>
      cars4partsClass(tag, "result-car"),
    );
    if (
      cars4partsElements(html, "div", (tag) =>
        cars4partsClass(tag, "result-car"),
      ).length !== blocks.length
    )
      throw new Error(
        "Native result cards exist outside the complete search-result region",
      );
    const rows = blocks.map((block) => {
      const anchors = cars4partsElements(block.body, "a");
      const destinations = anchors
        .filter(
          (item) =>
            cars4partsClass(item.tag, "result-car-link") ||
            cars4partsText(item.body) === "View Details",
        )
        .map((item) =>
          cars4partsLeafUrl(cars4partsAttribute(item.tag, "href") ?? ""),
        );
      const destination = destinations[0];
      if (
        !destination ||
        destinations.length !== 2 ||
        destinations.some((value) => value !== destination)
      )
        throw new Error(
          "Native row donor links are missing, conflicting or unowned",
        );
      const field = (name: string) =>
        cars4partsText(
          cars4partsOne(block.body, "p", (tag) => cars4partsClass(tag, name))
            .body,
        );
      const badges = cars4partsElements(block.body, "div", (tag) =>
        cars4partsClass(tag, "status-tag"),
      );
      const stocks = cars4partsElements(block.body, "p", (tag) =>
        cars4partsClass(tag, "stock-inventory"),
      ).map((item) =>
        cars4partsText(item.body).replace(/^Stock\s*#\s*:\s*/i, ""),
      );
      const image = [...block.body.matchAll(/<img\b[^>]*>/gi)][0]?.[0];
      return Cars4PartsRowSchema.parse({
        destination,
        ymm: field("vehicle-name"),
        branch: field("location-tag"),
        narrative: field("title-tag"),
        roleLabel:
          badges.length === 1 ? cars4partsText(badges[0]?.body ?? "") : null,
        stock: stocks.length === 1 ? stocks[0] : null,
        image: image ? cars4partsAttribute(image, "src") : null,
      });
    });
    if (!rows.length || rows.length > 200)
      throw new Error("Native result page is empty or oversized");
    return Cars4PartsPageSchema.parse({
      page,
      pages,
      rows,
      hash: cars4partsHash({ pages, rows }),
    });
  });
}
