import { createHash } from "node:crypto";
import {
  verifyPickapartvaOwner,
  verifyPickapartvaSearchTerminal,
  parsePickapartvaPagination,
} from "./pickapartva-protocol";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import {
  pickapartvaClass,
  pickapartvaDecode,
  pickapartvaDivs,
  pickapartvaText,
} from "./pickapartva-html";
import { pickapartvaImageUrl, pickapartvaStock } from "./pickapartva-transform";
import {
  PICKAPARTVA_MAX_PAGES,
  PICKAPARTVA_ORIGIN,
  PICKAPARTVA_PAGE_SIZE,
  pickapartvaMakeGroup,
  pickapartvaSearchHref,
  pickapartvaSetDate,
  type PickapartvaSearchScope,
  type PickapartvaYardCode,
} from "./pickapartva-yard-metadata";

export interface PickapartvaRecord {
  cardId: string | null;
  stock: string;
  year: string;
  make: string;
  model: string;
  vin: string;
  yardCode: PickapartvaYardCode;
  row: string;
  setDate: string;
  imageUrl: string | null;
}
export interface PickapartvaPage {
  page: number;
  lastPage: number;
  nextUrl: string | null;
  records: PickapartvaRecord[];
  /** The native make selector's makes, which a make split must cover. */
  makes: string[];
  hash: string;
}
export const pickapartvaHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** One native donor card's identity across catalog pages and searches. */
export const pickapartvaCardKey = (record: PickapartvaRecord) =>
  JSON.stringify([
    record.stock,
    record.vin.trim().toUpperCase(),
    record.setDate,
  ]);

function donor(
  card: { tag: string; body: string },
  makes: string[],
): PickapartvaRecord {
  const details = pickapartvaDivs(card.body, "car-details-uPull");
  const body = details[0]?.body;
  if (details.length !== 1 || body === undefined)
    throw new Error(
      "Pick-A-Part VA card has missing or repeated donor details",
    );
  const labels = [...body.matchAll(/<b\b[^>]*>([\s\S]*?)<\/b>/gi)];
  const fields = new Map<string, string>();
  const allowed = new Set([
    "Stock",
    "Year",
    "Make/Model",
    "Vin",
    "Location",
    "Row",
    "Set Date",
  ]);
  for (const label of labels) {
    const key = pickapartvaText(label[1] ?? "").replace(/[ :]+$/g, "");
    const tail = body.slice(label.index + label[0].length);
    const value = /^([^<]*)<br\s*\/?>/i.exec(tail)?.[1];
    if (!allowed.has(key) || fields.has(key) || value === undefined)
      throw new Error(
        "Pick-A-Part VA donor field contract is malformed or duplicated",
      );
    fields.set(key, pickapartvaText(value));
  }
  if (
    !["Year", "Make/Model", "Vin", "Location"].every((key) => fields.has(key))
  )
    throw new Error("Pick-A-Part VA donor required field label is missing");
  const location = fields.get("Location");
  const yardCode =
    location === "Fredericksburg"
      ? "TT87"
      : location === "Stafford"
        ? "UU81"
        : null;
  if (yardCode === null)
    throw new Error(
      "Pick-A-Part VA donor has unknown physical yard " + location,
    );
  const stock = fields.get("Stock") ?? "";
  const cardId = inventoryHtmlAttribute(card.tag, "id");
  if (pickapartvaStock(stock) !== null && stock !== cardId)
    throw new Error("Pick-A-Part VA stock/card binding changed");
  const combined = fields.get("Make/Model") ?? "";
  const make =
    makes.find((value) => combined.startsWith(value + " ")) ??
    (combined.includes(" ") ? (combined.split(" ")[0] ?? "") : combined);
  const model = combined.slice(make.length).trim();
  let imageUrl: string | null = null;
  for (const image of pickapartvaDivs(card.body, "card-img")) {
    const boundStock = inventoryHtmlAttribute(image.tag, "data-vstock-no");
    if (boundStock !== stock) continue;
    for (const [tag] of image.body.matchAll(/<a\b[^>]*>/gi)) {
      const raw = inventoryHtmlAttribute(tag, "href");
      const url =
        raw === null
          ? null
          : URL.parse(pickapartvaDecode(raw), PICKAPARTVA_ORIGIN);
      if (inventoryHtmlAttribute(tag, "data-lightbox") === stock)
        imageUrl = pickapartvaImageUrl(
          url?.href ?? null,
          yardCode,
          pickapartvaStock(stock),
        );
    }
  }
  return {
    cardId,
    stock,
    year: fields.get("Year") ?? "",
    make,
    model,
    vin: fields.get("Vin") ?? "",
    yardCode,
    row: fields.get("Row") ?? "",
    setDate: fields.get("Set Date") ?? "",
    imageUrl,
  };
}

/** The native make selector's makes, in native order. */
function pickapartvaMakes(html: string): string[] {
  const selects = [
    ...html.matchAll(/(<select\b[^>]*>)([\s\S]*?)<\/select>/gi),
  ].filter((match) => pickapartvaClass(match[1] ?? "", "upullsimpleMake"));
  if (selects.length !== 1)
    throw new Error("Pick-A-Part VA make selector changed");
  const makeOptions = [
    ...(selects[0]?.[2] ?? "").matchAll(
      /(<option\b[^>]*>)([\s\S]*?)<\/option>/gi,
    ),
  ];
  const selectedMakes = makeOptions.filter(
    (match) => inventoryHtmlAttribute(match[1] ?? "", "selected") !== null,
  );
  const effectiveMake = selectedMakes[0] ?? makeOptions[0];
  const effectiveValue = inventoryHtmlAttribute(
    effectiveMake?.[1] ?? "",
    "value",
  );
  const unfilteredMake =
    effectiveValue === "ANY" ||
    (effectiveValue === null &&
      pickapartvaText(effectiveMake?.[2] ?? "") === "Choose Make...");
  if (
    !unfilteredMake ||
    selectedMakes.length > 1 ||
    selectedMakes.some(
      (match) => inventoryHtmlAttribute(match[1] ?? "", "value") !== "ANY",
    ) ||
    makeOptions.some((match) => {
      const value = inventoryHtmlAttribute(match[1] ?? "", "value");
      return value !== null && value !== pickapartvaText(match[2] ?? "");
    }) ||
    !makeOptions.some(
      (match) => inventoryHtmlAttribute(match[1] ?? "", "value") === "ANY",
    )
  )
    throw new Error(
      "Pick-A-Part VA make selector has a narrowed or changed scope",
    );
  return [
    ...(selects[0]?.[2] ?? "").matchAll(
      /<option\b[^>]*>([\s\S]*?)<\/option>/gi,
    ),
  ]
    .map((match) => pickapartvaText(match[1] ?? ""))
    .filter((value) => !["ANY", "Choose Make..."].includes(value));
}

function pickapartvaRecords(
  cards: Array<{ tag: string; body: string }>,
  makes: string[],
): PickapartvaRecord[] {
  // The longest make first, so a longer make is never read as a shorter one.
  const byLength = [...makes].sort((a, b) => b.length - a.length);
  const records = cards.map((card) => donor(card, byLength));
  const ids = records.flatMap((record) =>
    record.cardId ? [record.cardId] : [],
  );
  if (new Set(ids).size !== ids.length)
    throw new Error("Pick-A-Part VA repeated card id within one page");
  return records;
}

const unbroken = (raw: string, html: string) =>
  Buffer.byteLength(raw) <= 4 * 1024 * 1024 && /<\/html>\s*$/i.test(html);

export function parsePickapartvaPage(
  raw: string,
  page: number,
): PickapartvaPage {
  const html = stripInventoryRawText(raw);
  if (
    !unbroken(raw, html) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > PICKAPARTVA_MAX_PAGES
  )
    throw new Error(
      "Pick-A-Part VA document is oversized, truncated or has an invalid page ordinal",
    );
  verifyPickapartvaOwner(html, raw);
  const control = parsePickapartvaPagination(html, page);
  const makes = pickapartvaMakes(html);
  const cards = pickapartvaDivs(html, "card-price");
  if (
    cards.length < 1 ||
    cards.length > PICKAPARTVA_PAGE_SIZE ||
    (page < control.lastPage && cards.length !== PICKAPARTVA_PAGE_SIZE) ||
    pickapartvaDivs(html, "car-details-uPull").length !== cards.length
  )
    throw new Error(
      "Pick-A-Part VA page is empty, truncated or has unmatched donor cards",
    );
  const records = pickapartvaRecords(cards, makes);
  return {
    page,
    lastPage: control.lastPage,
    nextUrl: control.nextUrl,
    records,
    makes,
    hash: pickapartvaHash([page, control.lastPage, control.nextUrl, records]),
  };
}

export interface PickapartvaSearchPage {
  date: string;
  id: PickapartvaSearchScope;
  /** `ANY`, or the one make a split yard search selected. */
  make: string;
  records: PickapartvaRecord[];
  hash: string;
}
/** A search page holds at most 500 cards, so a full page proves nothing about
 * further matches. A `capped` page still lists real donors of its date and
 * scope, which count toward the date's hidden donors; the caller narrows the
 * search when they are not enough. `makes` are the native makes it can be
 * split by. */
export type PickapartvaSearchResult =
  | { status: "complete"; page: PickapartvaSearchPage }
  | { status: "capped"; page: PickapartvaSearchPage; makes: string[] };

/**
 * The native search for one Set Date across every yard (`id` ANY), within
 * one physical yard, or for one make within one yard. It must answer the same
 * owner as the catalog, select exactly the searched yard and make, reflect the
 * searched date, publish no continuation and hold only donors of that make
 * (or its native make group) set on that date in that yard. Only a yard or
 * make search may answer with no donors.
 */
export function parsePickapartvaSearch(
  raw: string,
  date: string,
  id: PickapartvaSearchScope = "ANY",
  make = "ANY",
): PickapartvaSearchResult {
  const html = stripInventoryRawText(raw);
  if (
    !unbroken(raw, html) ||
    !pickapartvaSetDate(date) ||
    pickapartvaSearchHref(date, id, make) === null
  )
    throw new Error(
      "Pick-A-Part VA set-date search is oversized, truncated or has an invalid date, yard or make",
    );
  const empty = verifyPickapartvaOwner(html, raw, date, id, make);
  const makes = pickapartvaMakes(html);
  const cards = pickapartvaDivs(html, "card-price");
  if (empty) {
    if (
      cards.length ||
      [...html.matchAll(/<ul\b[^>]*>/gi)].some(([tag]) =>
        pickapartvaClass(tag, "pagination"),
      )
    )
      throw new Error(
        `Pick-A-Part VA ${make} search for ${date} in ${id} reports no results but lists donors or pages`,
      );
    return {
      status: "complete",
      page: { date, id, make, records: [], hash: pickapartvaHash([date, []]) },
    };
  }
  verifyPickapartvaSearchTerminal(html);
  if (
    cards.length < 1 ||
    pickapartvaDivs(html, "car-details-uPull").length !== cards.length
  )
    throw new Error(
      `Pick-A-Part VA set-date search for ${date} in ${id} returned ${cards.length} cards or unmatched donor cards; a repeated Set Date has at least one donor`,
    );
  if (cards.length > PICKAPARTVA_PAGE_SIZE)
    throw new Error(
      `Pick-A-Part VA set-date search for ${date} in ${id} returned ${cards.length} cards, more than one native page holds`,
    );
  const records = pickapartvaRecords(cards, makes);
  if (records.some((record) => record.setDate !== date))
    throw new Error(
      `Pick-A-Part VA set-date search for ${date} returned donors set on another date`,
    );
  if (id !== "ANY" && records.some((record) => record.yardCode !== id))
    throw new Error(
      `Pick-A-Part VA set-date search for ${date} in ${id} returned donors outside ${id}`,
    );
  if (
    make !== "ANY" &&
    records.some((record) => !pickapartvaMakeGroup(make).includes(record.make))
  )
    throw new Error(
      `Pick-A-Part VA set-date search for ${date} in ${id} ignored its selected make ${make}`,
    );
  // A make search holds only its own make's donors; its group's other makes
  // come from their own searches.
  const own =
    make === "ANY" ? records : records.filter((record) => record.make === make);
  const page = {
    date,
    id,
    make,
    records: own,
    hash: pickapartvaHash([date, own]),
  };
  return cards.length === PICKAPARTVA_PAGE_SIZE
    ? { status: "capped", page, makes }
    : { status: "complete", page };
}
