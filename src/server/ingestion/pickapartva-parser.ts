import { createHash } from "node:crypto";
import {
  verifyPickapartvaOwner,
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
  hash: string;
}
export const pickapartvaHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

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

export function parsePickapartvaPage(
  raw: string,
  page: number,
): PickapartvaPage {
  const html = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > 4 * 1024 * 1024 ||
    !/<\/html>\s*$/i.test(html) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > PICKAPARTVA_MAX_PAGES
  )
    throw new Error(
      "Pick-A-Part VA document is oversized, truncated or has an invalid page ordinal",
    );
  verifyPickapartvaOwner(html, raw);
  const control = parsePickapartvaPagination(html, page);
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
  const makes = [
    ...(selects[0]?.[2] ?? "").matchAll(
      /<option\b[^>]*>([\s\S]*?)<\/option>/gi,
    ),
  ]
    .map((match) => pickapartvaText(match[1] ?? ""))
    .filter((value) => !["ANY", "Choose Make..."].includes(value))
    .sort((a, b) => b.length - a.length);
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
  const records = cards.map((card) => donor(card, makes));
  const ids = records.flatMap((record) =>
    record.cardId ? [record.cardId] : [],
  );
  if (new Set(ids).size !== ids.length)
    throw new Error("Pick-A-Part VA repeated card id within one page");
  return {
    page,
    lastPage: control.lastPage,
    nextUrl: control.nextUrl,
    records,
    hash: pickapartvaHash([page, control.lastPage, control.nextUrl, records]),
  };
}
