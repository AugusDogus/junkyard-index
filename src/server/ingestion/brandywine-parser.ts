import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import { inventoryHtmlAttribute } from "./inventory-html";
import { type BrandywineBinding } from "./brandywine-catalog";
import {
  brandywineBody,
  brandywineClass,
  brandywineDecode,
  brandywineDocument,
  brandywineReceipt,
  brandywineRegions,
  brandywineRoute,
  brandywineText,
  type BrandywineReceipt,
} from "./brandywine-html";
import {
  BrandywineDetailSchema,
  type BrandywineDetail,
  type BrandywineRecord,
} from "./brandywine-record";

const unique = (values: string[]) => [...new Set(values)];
const usable = (value: string) =>
  Boolean(value) &&
  !/^(?:\[?(?:unknown|other)\]?|n\/?a|none|null|0+|-+|doesnotexist)$/i.test(
    value,
  );
const optional = (values: string[]) => {
  const choices = unique(values.filter(usable));
  return choices.length === 1 ? (choices[0] ?? null) : null;
};
function sourceDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? value
    : null;
}

export function extractBrandywineDetail(
  html: string,
  url: string,
  receipt?: BrandywineReceipt,
): BrandywineDetail {
  const document = brandywineDocument(html);
  const regions = brandywineRegions(document, "div", (tag) =>
    brandywineClass(tag, "vehdisplay2"),
  );
  const fields: { label: string; value: string }[] = [];
  const tables = brandywineRegions(document, "table");
  const boundaryErrors: string[] = [];
  if (
    regions.length !== 2 ||
    tables.length !== 1 ||
    !regions[0]?.body.includes(tables[0]?.full ?? "")
  )
    boundaryErrors.push("Native donor table and photo boundaries changed");
  for (const table of tables) {
    for (const row of brandywineRegions(table.body, "tr")) {
      const cells = brandywineRegions(row.body, "td");
      if (cells.length === 2)
        fields.push({
          label: brandywineText(cells[0]?.body ?? ""),
          value: brandywineText(cells[1]?.body ?? ""),
        });
      else if (
        cells.length !== 1 ||
        !/\bcolspan\s*=\s*["']?2/i.test(cells[0]?.tag ?? "")
      )
        boundaryErrors.push("Native donor row has unread cells");
    }
  }
  const destinations: string[] = [];
  for (const match of document.matchAll(/<(?:link|meta)\b[^>]*>/gi)) {
    const tag = match[0],
      key =
        inventoryHtmlAttribute(tag, "rel") ??
        inventoryHtmlAttribute(tag, "property");
    if (key !== "canonical" && key !== "og:url") continue;
    const value = brandywineDecode(
      inventoryHtmlAttribute(tag, "href") ??
        inventoryHtmlAttribute(tag, "content") ??
        "",
    );
    // The native WordPress template publishes this generic page URL for all stocks.
    if (value !== "https://www.brandywineupullit.com/veh_single/")
      destinations.push(value);
  }
  return BrandywineDetailSchema.parse({
    url,
    body: brandywineBody(html),
    receipt: brandywineReceipt(html, url, receipt),
    headings: brandywineRegions(document, "h1").map((h) =>
      brandywineText(h.body),
    ),
    titles: brandywineRegions(document, "title").map((h) =>
      brandywineText(h.body),
    ),
    fields,
    destinations,
    boundaryErrors: unique(boundaryErrors),
  });
}

/** Native maker/model lineage supplies the make. Identity never supplies YMM. */
export function acceptBrandywineDetail(
  raw: BrandywineDetail,
  bindings: BrandywineBinding[],
): BrandywineRecord {
  const values = (label: string) =>
    raw.fields.filter((f) => f.label === label).map((f) => f.value);
  const years = unique(
    [...raw.headings, ...bindings.map((b) => b.title)].map(
      (title) => /^(\d{4})\s/.exec(title)?.[1] ?? "",
    ),
  );
  const validVinClaims = unique(
    values("Vin:").flatMap((vin) =>
      years.flatMap((year) => {
        const value = inventoryVin(vin, year);
        return value === null ? [] : [value];
      }),
    ),
  );
  const claimedDestinations = unique([
    raw.url,
    ...raw.destinations.map((destination) =>
      destination === raw.receipt.finalUrl ? raw.url : destination,
    ),
    ...bindings.map((b) => b.url),
  ]);
  const nativeMarker = values("Row in Yard:")[0] ?? "";
  const marker = /^\[?unknown\]?$/i.test(nativeMarker) ? "" : nativeMarker;
  const base = { raw, bindings, validVinClaims, claimedDestinations, marker };
  const conflicts: string[] = [];
  const stock = URL.parse(raw.url)?.searchParams.get("stockno") ?? "";
  const detailStock = values("Stock Number:").filter((value) => value !== "");
  const heading = raw.headings[0] ?? "";
  const title = /^(\d{4})\s+(.+)$/.exec(heading);
  const year = title?.[1] ?? "",
    model = title?.[2] ?? "";
  const makeClaims = unique(
    bindings
      .filter((b) => b.scope !== "incoming")
      .map((b) => normalizeCanonicalMake(b.make)),
  );
  const make = makeClaims[0] ?? "";
  const vin = inventoryVin(values("Vin:")[0] ?? "", year);
  if (
    brandywineRoute(raw.url) !== "detail" ||
    detailStock.some((value) => value !== stock) ||
    bindings.length === 0 ||
    bindings.some(
      (b) =>
        b.stock !== stock ||
        b.url !== raw.url ||
        b.yard !== "Brandywine" ||
        b.scope === "incoming" ||
        b.title !== heading,
    ) ||
    makeClaims.length !== 1 ||
    claimedDestinations.some((url) => url !== raw.url)
  )
    conflicts.push("Native stock, destination, YMM or yard claims disagree");
  for (const label of ["Stock Number:", "Vin:", "Row in Yard:"])
    if (unique(values(label)).length > 1)
      conflicts.push("Conflicting native " + label + " claims");
  if (
    raw.headings.length > 1 ||
    raw.titles.some(
      (value) => value !== "Vehicle Record | Brandywine U-Pull-It",
    )
  )
    conflicts.push("Native donor headings or named YMM claims disagree");
  if (conflicts.length)
    return {
      ...base,
      status: "identity-conflict",
      reasons: conflicts,
      candidate: null,
    };
  const duplicateLabels = raw.fields.some(
    (field, index) =>
      raw.fields.findIndex((other) => other.label === field.label) !== index,
  );
  if (
    raw.boundaryErrors.length ||
    raw.headings.length !== 1 ||
    raw.titles.length !== 1 ||
    duplicateLabels ||
    values("Vin:").length !== 1
  )
    return {
      ...base,
      status: "boundary-unknown",
      reasons: [
        ...raw.boundaryErrors,
        "Native donor required-label boundary changed",
      ],
      candidate: null,
    };
  if (
    vin === null ||
    !/^\d{4}$/.test(year) ||
    Number(year) < 1886 ||
    Number(year) > 2100 ||
    !usable(make) ||
    /^AUSTIN\/MG\/TRIUMPH$/i.test(make) ||
    !usable(model)
  )
    return {
      ...base,
      status: "required-reject",
      reasons: [
        "Native VIN or supported older serial / year / make / model is missing or invalid",
      ],
      candidate: null,
    };
  // Optional position syntax is not an activity assertion. Retain the native
  // unresolved status/removal cues, without requiring a position allowlist.
  const activityWords = marker
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  if (
    marker !== "CRUSHED" &&
    marker !== "SOLD" &&
    (/^(?:YARD CAR|CHECK|DOESNOTEXIST)$/.test(activityWords) ||
      /\b(?:CRUSH(?:ED)?|SOLD|SCRAP(?:PED)?|HOLD(?:ING)?|REBUILD(?:ER|ABLE)?|INCOMING|AUCTION|REMOVED|INACTIVE)\b|NOT.*(?:YARD|AVAILABLE)|NO LONGER.*(?:YARD|AVAILABLE)|YARD USE/.test(
        activityWords,
      ))
  )
    return {
      ...base,
      status: "required-reject",
      reasons: ["Unresolved native Row in Yard marker: " + marker],
      candidate: null,
    };
  const nativeColor = optional(
    values("Color:").map((value) => value.replace(/^\[|\]$/g, "")),
  );
  const color =
    nativeColor !== null &&
    nativeColor.length <= 100 &&
    /^[a-z]+(?:[ /-][a-z]+)*$/i.test(nativeColor)
      ? normalizeCanonicalColor(nativeColor)
      : null;
  const nativePosition = optional([marker]);
  const row =
    nativePosition !== null &&
    /^[A-Z0-9][A-Z0-9 ./-]{0,79}$/i.test(nativePosition) &&
    marker !== "CRUSHED" &&
    marker !== "SOLD"
      ? nativePosition
      : null;
  return {
    ...base,
    status: "required-pass",
    reasons: [],
    candidate: {
      vin,
      year: Number(year),
      make,
      model,
      stockNumber: stock,
      color,
      row,
      availableDate: sourceDate(optional(values("Inventory Date:"))),
      detailsUrl: raw.receipt.finalUrl,
    },
  };
}
export function parseBrandywineDetail(
  html: string,
  url: string,
  bindings: BrandywineBinding[],
  receipt?: BrandywineReceipt,
) {
  return acceptBrandywineDetail(
    extractBrandywineDetail(html, url, receipt),
    bindings,
  );
}
