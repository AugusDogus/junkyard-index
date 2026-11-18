import { alsautoVehiclePhoto } from "./vehicle-photo";
import { z } from "zod";
import { stripInventoryRawText } from "./inventory-html";
import {
  prattAttribute,
  prattClass,
  prattElements,
  prattText,
} from "./pratt-html";
import { ALSAUTO_API, ALSAUTO_CATALOG } from "./alsauto-configuration";
import { vinplusCalendarDate } from "./vinplus-protocol";

export interface AlsautoRecord {
  year: number;
  make: string;
  model: string;
  vin: string;
  lot: string;
  acquired: string;
  imageUrl?: string | null;
}
export interface AlsautoPage {
  page: number;
  total: number;
  makes: string[];
  next: number | null;
  records: AlsautoRecord[];
}
const text = (html: string, tag: string, name: string): string => {
  const elements = prattElements(html, tag, (opening) =>
    prattClass(opening, name),
  );
  if (elements.length !== 1) throw new Error(`Expected one Al's ${name}`);
  return prattText(elements[0]?.body ?? "");
};
function widget(raw: string): string {
  const clean = stripInventoryRawText(raw);
  const regions = prattElements(
    clean,
    "div",
    (tag) => prattAttribute(tag, "id") === "als-vehicles-widget",
  );
  const region = regions[0];
  if (
    regions.length !== 1 ||
    !region ||
    prattAttribute(region.tag, "data-ajax-url") !== ALSAUTO_API ||
    prattAttribute(region.tag, "data-month-base") !== "/latest-inventory"
  )
    throw new Error("Al's public inventory widget or endpoint changed");
  const visible = prattText(region.body);
  if (
    !visible.includes("AL'S AUTO SALVAGE / PARTS INVENTORY") ||
    !visible.includes(
      "Dismantled for used parts, not sold complete. Call to confirm availability.",
    )
  )
    throw new Error("Al's active own-yard parts inventory assertion changed");
  return region.body;
}
function makes(html: string): string[] {
  const selects = prattElements(
    html,
    "select",
    (tag) => prattAttribute(tag, "name") === "make",
  );
  if (selects.length !== 1)
    throw new Error("Al's make directory is missing or ambiguous");
  const result = prattElements(selects[0]?.body ?? "", "option")
    .map(({ tag }) => prattAttribute(tag, "value"))
    .filter((value) => value !== "");
  const parsed = z
    .array(z.string().min(1).max(100))
    .min(1)
    .max(128)
    .parse(result);
  if (new Set(parsed).size !== parsed.length)
    throw new Error("Al's make directory repeats a selector");
  return parsed;
}
export function parseAlsautoOwner(raw: string): string[] {
  if (
    Buffer.byteLength(raw) > 256 * 1024 ||
    !/<\/body\s*>\s*<\/html\s*>\s*$/i.test(raw)
  )
    throw new Error("Al's owner document is oversized or incomplete");
  const html = stripInventoryRawText(raw),
    visible = prattText(html);
  const canonicals = [...html.matchAll(/<link\b[^>]*>/gi)].filter(
    ([tag]) => prattAttribute(tag, "rel") === "canonical",
  );
  if (
    canonicals.length !== 1 ||
    prattAttribute(canonicals[0]?.[0] ?? "", "href") !== ALSAUTO_CATALOG ||
    ![
      "Al's Auto Salvage",
      "10942 S 124th Street",
      "Franklin, WI 53132",
      "(414) 425-1890",
    ].every((claim) => visible.includes(claim))
  )
    throw new Error(
      "Al's inventory destination or physical yard ownership changed",
    );
  return makes(widget(html));
}
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
function date(value: string): string {
  const match = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(value);
  const parsed = match
    ? vinplusCalendarDate(
        Number(match[3]),
        months.indexOf(match[1] ?? "") + 1,
        Number(match[2]),
      )
    : null;
  if (!parsed) throw new Error("Al's acquisition date is invalid: " + value);
  return parsed;
}
/** The cached HTML route ignores query pagination. Only the published AJAX
 * filter endpoint supplies the requested page and an explicit active total. */
export function parseAlsautoPage(raw: string, page: number): AlsautoPage {
  if (Buffer.byteLength(raw) > 256 * 1024)
    throw new Error("Al's inventory response exceeds 256 KiB");
  const response = z
    .object({ html: z.string().min(1) })
    .strict()
    .parse(JSON.parse(raw));
  const html = widget(response.html),
    selectors = makes(html);
  const totalMatch = /^([\d,]+) vehicles$/.exec(
    text(html, "span", "als-results-count"),
  );
  const total = Number(totalMatch?.[1]?.replaceAll(",", ""));
  if (!Number.isSafeInteger(total) || total < 1 || total > 960)
    throw new Error(
      "Al's total is missing or exceeds the qualified 40-page bound",
    );
  const last = Math.ceil(total / 24);
  if (page < 1 || page > last)
    throw new Error("Al's requested page is outside the active inventory");
  const navs = prattElements(html, "nav", (tag) =>
    prattClass(tag, "als-widget-pages"),
  );
  if (navs.length !== 1)
    throw new Error("Al's complete pagination control is missing");
  const anchors = prattElements(navs[0]?.body ?? "", "a");
  const current = anchors.filter(
    ({ tag }) => prattAttribute(tag, "aria-current") === "page",
  );
  if (
    current.length !== 1 ||
    prattText(current[0]?.body ?? "") !== String(page)
  )
    throw new Error("Al's endpoint returned the wrong current page");
  for (const anchor of anchors) {
    if (
      !/^\/latest-inventory\?page=[1-9]\d*$/.test(
        prattAttribute(anchor.tag, "href") ?? "",
      )
    )
      throw new Error(
        "Al's pagination gained an unclassified filter or destination",
      );
  }
  const next = anchors.filter(({ body }) => prattText(body) === "Next");
  if (
    page < last
      ? next.length !== 1 ||
        prattAttribute(next[0]?.tag ?? "", "href") !==
          `/latest-inventory?page=${page + 1}`
      : next.length !== 0
  )
    throw new Error(
      "Al's pagination ends early or does not advance by one page",
    );
  const articles = prattElements(html, "article");
  if (
    articles.length !== (page === last ? total - (page - 1) * 24 : 24) ||
    articles.some(({ tag }) => !prattClass(tag, "als-widget-card"))
  )
    throw new Error("Al's page has missing, extra or unclassified donor cards");
  const records = articles.map(({ body }): AlsautoRecord => {
    const headings = prattElements(body, "h3");
    if (headings.length !== 1)
      throw new Error("Al's donor title is missing or ambiguous");
    const title = prattText(headings[0]?.body ?? ""),
      yearMatch = /^(\d{4}) (.+)$/.exec(title);
    const remainder = yearMatch?.[2] ?? "";
    // Two native Nissan titles use the acquisition abbreviation NISS.
    const make = [
      ...selectors,
      ...(selectors.includes("NISSAN") ? ["NISS"] : []),
    ]
      .sort((a, b) => b.length - a.length)
      .find((label) => remainder.startsWith(label + " "));
    if (!yearMatch || !make)
      throw new Error(
        "Al's donor title does not match its published make directory: " +
          title,
      );
    const definitions = prattElements(body, "dl");
    if (definitions.length !== 1)
      throw new Error("Al's donor metadata is missing");
    const labels = prattElements(definitions[0]?.body ?? "", "dt").map(
      ({ body }) => prattText(body),
    );
    const values = prattElements(definitions[0]?.body ?? "", "dd");
    if (
      JSON.stringify(labels) !== JSON.stringify(["VIN", "Lot #", "Acquired"]) ||
      values.length !== 3
    )
      throw new Error("Al's donor fields changed");
    const vinBody = values[0]?.body ?? "",
      vins = prattElements(vinBody, "span", (tag) =>
        prattClass(tag, "als-vin-text"),
      );
    // Missing VINs are explicitly displayed as 'Not listed', without a span.
    const vin =
      vins.length === 1 ? prattText(vins[0]?.body ?? "") : prattText(vinBody);
    if (vins.length > 1 || (!vins.length && vin !== "Not listed"))
      throw new Error("Al's donor VIN field is ambiguous");
    const lot = prattText(values[1]?.body ?? "");
    if (!/^\d{8}$/.test(lot))
      throw new Error("Al's native lot identity changed");
    return {
      imageUrl:
        prattElements(body, "div", (tag) => prattClass(tag, "als-widget-image"))
          .flatMap(({ body }) => [...body.matchAll(/<img\b[^>]*>/gi)])
          .filter(([tag]) => prattAttribute(tag, "alt") === title)
          .map(([tag]) => alsautoVehiclePhoto(prattAttribute(tag, "src")))
          .find((url) => url !== null) ?? null,
      year: Number(yearMatch[1]),
      make,
      model: remainder.slice(make.length + 1),
      vin,
      lot,
      acquired: date(prattText(values[2]?.body ?? "")),
    };
  });
  return {
    page,
    total,
    makes: selectors,
    next: page < last ? page + 1 : null,
    records,
  };
}
