import { z } from "zod";
import {
  michigantruckDivs as divs,
  michigantruckText as text,
  michigantruckDocument,
} from "./michigantruck-html";
import type { MichigantruckRecord } from "./michigantruck-record";
import { MICHIGANTRUCK_SALVAGE } from "./michigantruck-yard-metadata";

/** Source-linked detail evidence establishes native Salvage semantics and the
 * independently published selector. Sidebar malformed hrefs are never repaired. */
export function parseMichigantruckControl(
  raw: string,
  record: MichigantruckRecord,
): string {
  const html = michigantruckDocument(raw);
  const titles = divs(html, "desc-title");
  const headings = [
    ...(titles[0] ?? "").matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi),
  ];
  if (
    titles.length !== 1 ||
    headings.length !== 1 ||
    !/^Salvage \d{4} .* - Lot #/.test(text(headings[0]?.[1] ?? ""))
  )
    throw new Error(
      "Michigan Truck detail no longer identifies native Salvage",
    );
  const fields = new Map<string, string>();
  for (const pair of html.matchAll(
    /<div\b[^>]*class=['"][^'"]*\btpi-portal-plugin__detail-title\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*class=['"][^'"]*\btpi-portal-plugin__detail-description\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>/gi,
  )) {
    const label = text(pair[1] ?? "");
    if (fields.has(label))
      throw new Error("Michigan Truck detail repeats " + label);
    fields.set(label, text(pair[2] ?? ""));
  }
  for (const [label, value] of [
    ["Year", record.year],
    ["Make", record.make],
    ["Model", record.model],
    ["VIN", record.vin],
  ] as const)
    if ((fields.get(label) ?? "").toUpperCase() !== value.toUpperCase())
      throw new Error("Michigan Truck detail and listing disagree on " + label);
  for (const [label, value] of [
    ["Lot Number", record.stockNumber],
    ["Engine Model", record.engine],
  ] as const)
    if (value && fields.get(label) && fields.get(label) !== value)
      throw new Error("Michigan Truck detail and listing disagree on " + label);
  const breadcrumbs = z.array(z.object({ name: z.string(), item: z.string() }));
  const selectors: string[] = [];
  for (const script of raw.matchAll(
    /<script\b[^>]*type=['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const parsed = breadcrumbs.safeParse(JSON.parse(script[1] ?? ""));
    if (parsed.success)
      for (const item of parsed.data)
        if (item.name === "Salvage") selectors.push(item.item);
  }
  if (
    selectors.length !== 1 ||
    ![
      MICHIGANTRUCK_SALVAGE,
      "http://michigantruck.com/trucks/?f-condition=nw",
    ].includes(selectors[0] ?? "")
  )
    throw new Error(
      "Michigan Truck detail's published Salvage selector changed",
    );
  return MICHIGANTRUCK_SALVAGE;
}
