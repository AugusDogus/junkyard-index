import { createHash } from "node:crypto";
import { inventoryHtmlAttribute } from "./inventory-html";
import {
  ALLIED_ORIGIN,
  alliedAttribute,
  alliedBrowsePath,
  alliedClass,
  alliedContinuation,
  alliedDocument,
  alliedElements,
  alliedRegion,
  alliedText,
} from "./allied-html";
import {
  AlliedControlSchema,
  AlliedRecordSchema,
  type AlliedContext,
  type AlliedControl,
  type AlliedRecord,
} from "./allied-record";
import { AlliedResult } from "./allied-result";

export interface AlliedPage {
  context: AlliedContext;
  records: AlliedRecord[];
  hash: string;
  nativeEmpty: boolean;
}
export const alliedHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const region = (html: string) =>
  alliedRegion(html, (tag) => alliedAttribute(tag, "id") === "iiscont");
const terminal = (html: string) => {
  if (alliedContinuation(html).length)
    throw new Error(
      "Unclassified native continuation is unread; inspect its literal owned controls before emission",
    );
};
const empty = (html: string) =>
  alliedElements(html, "h3").some((element) =>
    /^No Results Found\. Try Browsing Our Parts Or Search Again$/i.test(
      alliedText(element.body),
    ),
  );

export function parseAlliedDirectory(
  raw: string,
  context: { kind: "makes" } | { kind: "models"; make: AlliedControl },
) {
  return AlliedResult.boundary("native " + context.kind + " directory", () => {
    const document = alliedDocument(raw);
    terminal(document);
    const html = context.kind === "makes" ? document : region(document);
    const menuMatches = (tag: string) =>
      context.kind === "makes"
        ? alliedClass(tag, "iisMakesMenu")
        : alliedAttribute(tag, "id") === "menumodellist";
    if (
      context.kind === "models" &&
      empty(html) &&
      alliedElements(html, "div", menuMatches).length === 0
    )
      return [];
    // Account for every anchor in the published menu, even if its CSS class
    // changes. A malformed control must never silently shrink the graph.
    const links = alliedElements(alliedRegion(html, menuMatches), "a");
    if (empty(html) && links.length)
      throw new Error(
        "Native empty directory contradicts its published controls",
      );
    const controls = links.map((link) => {
      const badges = alliedElements(link.body, "span", (tag) =>
        alliedClass(tag, "badge"),
      );
      const badge = badges[0];
      const count = alliedText(badge?.body ?? "");
      const path = alliedBrowsePath(
        alliedAttribute(link.tag, "href") ?? "",
        context.kind === "makes" ? 1 : 2,
      );
      const label = alliedText(
        link.body.replace(
          /(<span\b[^>]*>)[\s\S]*?<\/span\s*>/gi,
          (literal: string, tag: string) =>
            alliedClass(tag, "badge") ? "" : literal,
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
      return AlliedControlSchema.parse({ path, label, count: Number(count) });
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

function cards(html: string, context: AlliedContext): AlliedPage {
  terminal(html);
  const blocks = alliedElements(html, "div", (tag) =>
    alliedClass(tag, "card-price"),
  );
  if (
    alliedElements(html, "div", (tag) => alliedClass(tag, "car-details"))
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
    alliedElements(html, "div", (tag) => alliedClass(tag, "card-deck"))
      .length !== 1
  )
    throw new Error("Expected one native donor card deck");
  const records = blocks.map(({ body }) => {
    const details = alliedRegion(body, (tag) =>
      alliedClass(tag, "car-details"),
    );
    const fields = new Map<string, string[]>();
    for (const match of details.matchAll(
      /<b\b[^>]*>([\s\S]*?)<\/b\s*>([\s\S]*?)<br\s*\/?\s*>/gi,
    )) {
      const label = alliedText(match[1] ?? "")
        .replace(/\s*:\s*$/, "")
        .toLowerCase();
      fields.set(label, [
        ...(fields.get(label) ?? []),
        alliedText(match[2] ?? ""),
      ]);
    }
    const optional = (label: string) => {
      const values = [...new Set(fields.get(label) ?? [])].filter(Boolean);
      return values.length === 1 ? (values[0] ?? null) : null;
    };
    const destinations = alliedElements(body, "a").flatMap((link) => {
      const raw = alliedAttribute(link.tag, "href") ?? "";
      const url = URL.parse(raw, ALLIED_ORIGIN);
      return /^See Parts\b/.test(alliedText(link.body)) ||
        url?.pathname.startsWith("/parts/")
        ? [url?.href ?? raw]
        : [];
    });
    const inquiries = [...body.matchAll(/<[^/!][^>]*>/g)].flatMap(([tag]) => {
      const value = inventoryHtmlAttribute(tag, "data-vehicle");
      return value === null ? [] : [alliedText(value)];
    });
    const primaryRegion =
      alliedElements(body, "div", (tag) => alliedClass(tag, "card-img"))[0]
        ?.body ?? "";
    const imageTag = [...primaryRegion.matchAll(/<img\b[^>]*>/gi)][0]?.[0];
    let image: string | null = null;
    if (imageTag) {
      // Optional malformed metadata cannot erase supplied required identities.
      const parsed = AlliedResult.boundary(
        "optional primary image",
        () =>
          alliedAttribute(imageTag, "data-src") ??
          alliedAttribute(imageTag, "src"),
      );
      if (parsed.ok) image = parsed.value;
    }
    const stocks = [...new Set(fields.get("stock") ?? [])].filter(Boolean);
    if (stocks.length > 1)
      throw new Error(
        "Native card has conflicting stock codes; donor eligibility cannot be established. Inspect the labelled stock fields before resuming",
      );
    return AlliedRecordSchema.parse({
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
  return { context, records, nativeEmpty, hash: alliedHash(records) };
}
export function parseAlliedModel(
  raw: string,
  context: { make: AlliedControl; model: AlliedControl },
) {
  return AlliedResult.boundary("model " + context.model.path, () => {
    const document = alliedDocument(raw);
    terminal(document);
    return cards(region(document), { kind: "model", ...context });
  });
}
export function parseAlliedArrivals(raw: string) {
  return AlliedResult.boundary("native arrivals", () => {
    const html = alliedDocument(raw);
    const titles = alliedElements(html, "title");
    if (
      titles.length !== 1 ||
      alliedText(titles[0]?.body ?? "") !==
        "Latest Vehicle Arrivals | Allied Auto Wrecking"
    )
      throw new Error("Native latest-arrival title is missing or changed");
    return cards(html, { kind: "arrivals" });
  });
}
export function parseAlliedOwner(
  raw: string,
  expected: { name: string; address: string; city: string; postalCode: string },
) {
  return AlliedResult.boundary("physical owner", () => {
    const text = alliedText(alliedDocument(raw)).replace(/’/g, "'");
    if (
      ![
        expected.name,
        expected.address,
        expected.city,
        expected.postalCode,
      ].every((claim) => text.includes(claim))
    )
      throw new Error(
        "Official Weare yard identity or address changed; inspect the saved native homepage",
      );
    return alliedHash(expected);
  });
}
