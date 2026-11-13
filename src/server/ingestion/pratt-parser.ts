import { createHash } from "node:crypto";
import { inventoryHtmlAttribute } from "./inventory-html";
import {
  PRATT_ORIGIN,
  prattAttribute,
  prattBrowsePath,
  prattClass,
  prattContinuation,
  prattDocument,
  prattElements,
  prattRegion,
  prattText,
} from "./pratt-html";
import {
  PrattControlSchema,
  PrattRecordSchema,
  type PrattContext,
  type PrattControl,
  type PrattRecord,
} from "./pratt-record";
import { PrattResult } from "./pratt-result";

export interface PrattPage {
  context: PrattContext;
  records: PrattRecord[];
  hash: string;
  nativeEmpty: boolean;
}
export const prattHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const region = (html: string) =>
  prattRegion(html, (tag) => prattAttribute(tag, "id") === "iiscont");
const terminal = (html: string) => {
  if (prattContinuation(html).length)
    throw new Error(
      "Unclassified native continuation is unread; inspect its literal owned controls before emission",
    );
};
const empty = (html: string) =>
  prattElements(html, "h3").some((element) =>
    /^No Results Found\. Try Browsing Our Parts Or Search Again$/i.test(
      prattText(element.body),
    ),
  );

export function parsePrattDirectory(
  raw: string,
  context: { kind: "makes" } | { kind: "models"; make: PrattControl },
) {
  return PrattResult.boundary("native " + context.kind + " directory", () => {
    const document = prattDocument(raw);
    terminal(document);
    const html = region(document);
    const menuMatches = (tag: string) =>
      context.kind === "makes"
        ? prattClass(tag, "iisMakesMenu")
        : prattAttribute(tag, "id") === "menumodellist";
    if (
      context.kind === "models" &&
      empty(html) &&
      prattElements(html, "div", menuMatches).length === 0
    )
      return [];
    // Account for every anchor in the published menu, even if its CSS class
    // changes. A malformed control must never silently shrink the graph.
    const links = prattElements(prattRegion(html, menuMatches), "a");
    if (empty(html) && links.length)
      throw new Error(
        "Native empty directory contradicts its published controls",
      );
    const controls = links.map((link) => {
      const badges = prattElements(link.body, "span", (tag) =>
        prattClass(tag, "badge"),
      );
      const badge = badges[0];
      const count = prattText(badge?.body ?? "");
      const path = prattBrowsePath(
        prattAttribute(link.tag, "href") ?? "",
        context.kind === "makes" ? 1 : 2,
      );
      const label = prattText(
        link.body.replace(
          /(<span\b[^>]*>)[\s\S]*?<\/span\s*>/gi,
          (literal: string, tag: string) =>
            prattClass(tag, "badge") ? "" : literal,
        ),
      );
      if (
        !path ||
        badges.length !== 1 ||
        !/^\d+$/.test(count) ||
        !label ||
        (context.kind === "models" &&
          !path.startsWith(context.make.path.replace(/\/$/, "") + "/"))
      )
        throw new Error(
          "Published control has an invalid literal path, parent, label or dedicated badge; no control was silently omitted",
        );
      return PrattControlSchema.parse({ path, label, count: Number(count) });
    });
    if (
      !controls.length ||
      controls.length > 1024 ||
      new Set(controls.map((control) => control.path)).size !== controls.length
    )
      throw new Error(
        "Native directory is empty, oversized or repeats a literal destination",
      );
    return controls;
  });
}

function cards(html: string, context: PrattContext): PrattPage {
  terminal(html);
  const blocks = prattElements(html, "div", (tag) =>
    prattClass(tag, "card-price"),
  );
  if (
    prattElements(html, "div", (tag) => prattClass(tag, "car-details"))
      .length !== blocks.length
  )
    throw new Error(
      "Native identity regions exist outside accounted donor cards",
    );
  const nativeEmpty = empty(html);
  if ((!blocks.length && !nativeEmpty) || (blocks.length && nativeEmpty))
    throw new Error(
      "Native cards are missing without an explicit empty result, or contradict the empty result",
    );
  if (blocks.length >= 500)
    throw new Error(
      "Native 500-card boundary reached; completeness is unknown and no inventory may be emitted",
    );
  if (
    blocks.length &&
    prattElements(html, "div", (tag) => prattClass(tag, "card-deck")).length !==
      1
  )
    throw new Error("Expected one native donor card deck");
  const records = blocks.map(({ body }) => {
    const details = prattRegion(body, (tag) => prattClass(tag, "car-details"));
    const fields = new Map<string, string[]>();
    for (const match of details.matchAll(
      /<b\b[^>]*>([\s\S]*?)<\/b\s*>([\s\S]*?)<br\s*\/?\s*>/gi,
    )) {
      const label = prattText(match[1] ?? "")
        .replace(/\s*:\s*$/, "")
        .toLowerCase();
      fields.set(label, [
        ...(fields.get(label) ?? []),
        prattText(match[2] ?? ""),
      ]);
    }
    const optional = (label: string) => {
      const values = [...new Set(fields.get(label) ?? [])].filter(Boolean);
      return values.length === 1 ? (values[0] ?? null) : null;
    };
    const destinations = prattElements(body, "a").flatMap((link) => {
      const raw = prattAttribute(link.tag, "href") ?? "";
      const url = URL.parse(raw, PRATT_ORIGIN);
      return /^See Parts\b/.test(prattText(link.body)) ||
        url?.pathname.startsWith("/parts/")
        ? [url?.href ?? raw]
        : [];
    });
    const inquiries = [...body.matchAll(/<[^/!][^>]*>/g)].flatMap(([tag]) => {
      const value = inventoryHtmlAttribute(tag, "data-vehicle");
      return value === null ? [] : [prattText(value)];
    });
    const primaryRegion =
      prattElements(body, "div", (tag) => prattClass(tag, "card-img"))[0]
        ?.body ?? "";
    const imageTag = [...primaryRegion.matchAll(/<img\b[^>]*>/gi)][0]?.[0];
    let image: string | null = null;
    if (imageTag) {
      // Optional malformed metadata cannot erase supplied required identities.
      const parsed = PrattResult.boundary(
        "optional primary image",
        () =>
          prattAttribute(imageTag, "data-src") ??
          prattAttribute(imageTag, "src"),
      );
      if (parsed.ok) image = parsed.value;
    }
    return PrattRecordSchema.parse({
      years: fields.get("year") ?? [],
      titles: fields.get("make/model") ?? [],
      vins: fields.get("vin") ?? [],
      inquiries,
      destinations,
      stock: optional("stock"),
      image,
      date: optional("enter date"),
    });
  });
  return { context, records, nativeEmpty, hash: prattHash(records) };
}
export function parsePrattModel(
  raw: string,
  context: { make: PrattControl; model: PrattControl },
) {
  return PrattResult.boundary("model " + context.model.path, () => {
    const document = prattDocument(raw);
    terminal(document);
    return cards(region(document), { kind: "model", ...context });
  });
}
export function parsePrattArrivals(raw: string) {
  return PrattResult.boundary("native arrivals", () => {
    const html = prattDocument(raw);
    const titles = prattElements(html, "title");
    if (
      titles.length !== 1 ||
      prattText(titles[0]?.body ?? "") !==
        "Latest Arrivals | Pratt's Auto Salvage"
    )
      throw new Error("Native latest-arrival title is missing or changed");
    return cards(html, { kind: "arrivals" });
  });
}
export function parsePrattOwner(
  raw: string,
  expected: { name: string; address: string; city: string; postalCode: string },
) {
  return PrattResult.boundary("physical owner", () => {
    const text = prattText(prattDocument(raw)).replace(/’/g, "'");
    if (
      ![
        expected.name,
        expected.address,
        expected.city,
        expected.postalCode,
      ].every((claim) => text.includes(claim))
    )
      throw new Error(
        "Official Hoxie yard identity or address changed; inspect the saved native homepage",
      );
    return prattHash(expected);
  });
}
