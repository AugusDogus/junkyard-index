import { z } from "zod";
import {
  BrandywineBodySchema,
  BrandywineReceiptSchema,
  brandywineBody,
  brandywineClass,
  brandywineDocument,
  brandywineReceipt,
  brandywineRegions,
  brandywineRoute,
  brandywineText,
  type BrandywineReceipt,
} from "./brandywine-html";
import { BRANDYWINE_ORIGIN } from "./brandywine-yard-metadata";
import { inventoryHtmlAttribute } from "./inventory-html";
import { brandywineDecode } from "./brandywine-html";

export const BRANDYWINE_MAX_MAKERS = 64;
export const BRANDYWINE_MAX_MODELS = 512;
export const BRANDYWINE_MAX_DONORS = 3000;
export const BRANDYWINE_MAX_ROWS = 6000;
export const BrandywineRowSchema = z
  .object({
    yard: z.enum(["Brandywine", "Fort Washington"]),
    stock: z.string().regex(/^[A-Z0-9]{1,16}$/),
    title: z.string().max(200),
    date: z.string().max(100),
    url: z.string().max(512),
  })
  .strict();
export type BrandywineRow = z.infer<typeof BrandywineRowSchema>;
const entry = z
  .object({ label: z.string().min(1).max(100), url: z.string().max(512) })
  .strict();
const common = {
  url: z.string().max(512),
  body: BrandywineBodySchema,
  receipt: BrandywineReceiptSchema,
};
export const BrandywineControlSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...common,
      kind: z.literal("root"),
      binding: z.literal("Brandywine headquarters / Fort Washington Savemore"),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("manufacturers"),
      entries: z.array(entry).min(1).max(BRANDYWINE_MAX_MAKERS),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("models"),
      entries: z.array(entry).max(BRANDYWINE_MAX_MODELS),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("stock"),
      scope: z.enum(["current", "incoming", "fresh"]),
      rows: z.array(BrandywineRowSchema).max(BRANDYWINE_MAX_ROWS),
    })
    .strict(),
]);
export type BrandywineControl = z.infer<typeof BrandywineControlSchema>;
export const BrandywineBindingSchema = BrandywineRowSchema.extend({
  make: z.string().max(100),
  scope: z.enum(["current", "incoming", "fresh"]),
}).strict();
export type BrandywineBinding = z.infer<typeof BrandywineBindingSchema>;

function tables(html: string) {
  const values = brandywineRegions(html, "table");
  if ([...html.matchAll(/<\/?table\b/gi)].length !== values.length * 2)
    throw new Error("Brandywine has an incomplete native table");
  return values;
}
function rows(html: string) {
  const values = brandywineRegions(html, "tr");
  if ([...html.matchAll(/<\/?tr\b/gi)].length !== values.length * 2)
    throw new Error("Brandywine has an incomplete native row");
  return values;
}
function cells(html: string, element: "td" | "th") {
  const values = brandywineRegions(html, element);
  if (
    [...html.matchAll(new RegExp(`<\\/?${element}\\b`, "gi"))].length !==
    values.length * 2
  )
    throw new Error("Brandywine has an incomplete native cell");
  return values;
}
function nativeRegion(html: string) {
  const regions = brandywineRegions(html, "div", (tag) =>
    brandywineClass(tag, "vehrecords"),
  );
  if (
    regions.length !== 1 ||
    !regions[0] ||
    /<form\b|\brel\s*=\s*["'](?:next|prev)/i.test(regions[0].body)
  )
    throw new Error(
      "Brandywine native inventory boundary or continuation contract changed",
    );
  return regions[0].body;
}
function entries(html: string, path: string, key: string) {
  const region = nativeRegion(html),
    nativeTables = tables(region);
  if (nativeTables.length !== 1 || !nativeTables[0])
    throw new Error("Brandywine menu table boundary changed");
  const values: { label: string; url: string }[] = [];
  for (const row of rows(nativeTables[0].body)) {
    // Native manufacturer names omit </a> immediately before </h6>.
    const links = [
      ...row.body.matchAll(
        /(<a\b[^>]*>)([\s\S]*?)(?:<\/a\s*>|(?=<\/h6\s*>))/gi,
      ),
    ].map((match) => ({
      label: brandywineText(match[2] ?? ""),
      href: brandywineDecode(
        inventoryHtmlAttribute(match[1] ?? "", "href") ?? "",
      ),
    }));
    if (links.length !== [...row.body.matchAll(/<a\b/gi)].length)
      throw new Error("Brandywine native menu anchor boundary changed");
    if (!links.length) {
      if (brandywineText(row.body) !== "Go Back")
        throw new Error("Brandywine has an unread native menu row");
      continue;
    }
    const named = links.filter((link) => link.label);
    if (named.length !== 1 || !named[0])
      throw new Error("Brandywine menu has ambiguous labels");
    const namedLink = named[0],
      url = new URL(namedLink.href, BRANDYWINE_ORIGIN);
    if (
      url.pathname !== path ||
      url.searchParams.get(key) !== namedLink.label ||
      [...url.searchParams].length !== 1 ||
      brandywineRoute(url.href) === null ||
      links.some(
        (link) => new URL(link.href, BRANDYWINE_ORIGIN).href !== url.href,
      )
    )
      throw new Error(
        "Brandywine menu label and exact native destination disagree",
      );
    values.push({ label: namedLink.label, url: url.href });
  }
  if (new Set(values.map((value) => value.url)).size !== values.length)
    throw new Error("Brandywine menu repeats a native relation");
  return values;
}
export function parseBrandywineControl(
  html: string,
  url: string,
  receipt?: BrandywineReceipt,
): BrandywineControl {
  const document = brandywineDocument(html),
    route = brandywineRoute(url);
  const base = {
    url,
    body: brandywineBody(html),
    receipt: brandywineReceipt(html, url, receipt),
  };
  const text = brandywineText(document);
  if (route === "root") {
    if (
      !/Brandywine Auto Parts 14000 Crain Hwy Brandywine, MD, 20613 301-242-9494/.test(
        text,
      ) ||
      !text.includes(
        "shares a parking lot with our headquarters and full service yard",
      ) ||
      !text.includes("shares a parking lot with our Savemore Auto Parts yard")
    )
      throw new Error(
        "Brandywine native headquarters, address, phone or separate Savemore binding changed",
      );
    return BrandywineControlSchema.parse({
      ...base,
      kind: "root",
      binding: "Brandywine headquarters / Fort Washington Savemore",
    });
  }
  if (route === "manufacturers" || route === "models") {
    const heading =
      route === "manufacturers"
        ? "Select your vehicle manufacturer!"
        : "Select Vehicle Model";
    if (
      !brandywineRegions(document, "h1").some(
        (h) => brandywineText(h.body) === heading,
      )
    )
      throw new Error("Brandywine native menu heading changed");
    return BrandywineControlSchema.parse({
      ...base,
      kind: route,
      entries: entries(
        document,
        route === "manufacturers" ? "/veh_model_list" : "/veh_model_breakdown",
        route === "manufacturers" ? "modelinput" : "vehiclename",
      ),
    });
  }
  if (route !== "stock" && route !== "incoming" && route !== "fresh")
    throw new Error(
      "Brandywine control URL is outside the published native graph",
    );
  const scope = route === "stock" ? "current" : route;
  const expectedHeading =
    scope === "current"
      ? "In Stock Vehicles"
      : scope === "incoming"
        ? "Incoming Stock"
        : "Just hit the yard!";
  const headings = brandywineRegions(document, "h1").map((h) =>
    brandywineText(h.body),
  );
  if (
    JSON.stringify(headings) !==
      JSON.stringify([expectedHeading, "Brandywine", "Fort Washington"]) ||
    (scope === "current" &&
      (!text.includes(
        "Below are the current vehicles we have in stock that match your selection.",
      ) ||
        !text.includes(
          "Vehicles located at our headquarters are listed under the Brandywine, MD header.",
        ) ||
        !text.includes(
          "Vehicles located at Savemore are listed under the Fort Washington, MD header.",
        ))) ||
    (scope === "incoming" && !text.includes("haven’t hit the yard yet"))
  )
    throw new Error(
      "Brandywine native yard scope, table order or inventory statement changed",
    );
  const region = nativeRegion(document),
    nativeTables = tables(region);
  if (nativeTables.length !== 2)
    throw new Error("Brandywine requires both separate native yard tables");
  const nativeRows: BrandywineRow[] = [];
  let tableOffset = 0;
  for (const [index, table] of nativeTables.entries()) {
    const yard = index === 0 ? "Brandywine" : "Fort Washington";
    // The heading must immediately precede its own table, not a later table.
    const tablePosition = region.indexOf(table.full, tableOffset);
    const before = region.slice(0, tablePosition);
    tableOffset = tablePosition + table.full.length;
    if (
      brandywineText(brandywineRegions(before, "h1").at(-1)?.body ?? "") !==
      yard
    )
      throw new Error("Brandywine table lost its adjacent yard heading");
    const tableRows = rows(table.body),
      head = tableRows.shift();
    const expected = [
      "Stock Number",
      "Year Make Model",
      scope === "incoming" ? "Date Entered" : "Date Inventoried",
    ];
    if (
      !head ||
      JSON.stringify(
        cells(head.body, "th").map((c) => brandywineText(c.body)),
      ) !== JSON.stringify(expected)
    )
      throw new Error("Brandywine native stock table columns changed");
    for (const row of tableRows) {
      const values = cells(row.body, "td"),
        stock = brandywineText(values[0]?.body ?? "");
      // Native stock cells omit </a>. Accept that exact cell-local grammar only.
      const link = /^\s*(<a\b[^>]*>)([^<]*)(?:<\/a\s*>)?\s*$/i.exec(
        values[0]?.body ?? "",
      );
      const href = link
        ? brandywineDecode(inventoryHtmlAttribute(link[1] ?? "", "href") ?? "")
        : "";
      const destination = href ? URL.parse(href, BRANDYWINE_ORIGIN) : null;
      if (
        values.length !== 3 ||
        !link ||
        brandywineText(link[2] ?? "") !== stock ||
        !destination ||
        destination.pathname !== "/veh_single" ||
        destination.searchParams.get("stockno") !== stock ||
        brandywineRoute(destination.href) !== "detail" ||
        [...row.body.matchAll(/<a\b/gi)].length !== 1
      )
        throw new Error(
          "Brandywine native stock row or exact donor destination changed",
        );
      nativeRows.push(
        BrandywineRowSchema.parse({
          yard,
          stock,
          title: brandywineText(values[1]?.body ?? ""),
          date: brandywineText(values[2]?.body ?? ""),
          url: destination.href,
        }),
      );
    }
  }
  return BrandywineControlSchema.parse({
    ...base,
    kind: "stock",
    scope,
    rows: nativeRows,
  });
}

/** Only native required membership and ownership, excluding volatile body bytes. */
export function brandywineMembership(control: BrandywineControl) {
  if (control.kind === "root")
    return { url: control.url, kind: control.kind, binding: control.binding };
  if (control.kind === "stock")
    return {
      url: control.url,
      kind: control.kind,
      scope: control.scope,
      rows: control.rows
        .map(({ date: _date, ...row }) => row)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    };
  return {
    url: control.url,
    kind: control.kind,
    entries: [...control.entries].sort((a, b) => a.url.localeCompare(b.url)),
  };
}
