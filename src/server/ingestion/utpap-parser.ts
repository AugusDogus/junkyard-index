import { z } from "zod";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import {
  UTPAP_ORIGIN,
  UTPAP_YARDS,
  type UtpapYardCode,
} from "./utpap-yard-metadata";

const field = z.string().max(500);
export const UtpapRecordSchema = z.object({
  S3CLIENTID: z.enum(["1064", "1065"]),
  YARD_NAME: field,
  YARD_CITY: field,
  YARD_STATE: z.literal("UT"),
  STOCKNUMBER: field,
  iSTATUS: z.literal("0"),
  LOCATION: z.literal("YARD"),
  iYEAR: field,
  MAKE: field,
  MODEL: field,
  VEHICLE_ROW: field,
  YARD_DATE: field,
  COLOR: field,
  VIN: field,
  REFERENCE: field,
});
export type UtpapRecord = z.infer<typeof UtpapRecordSchema>;
export const UtpapPhotoRowSchema = z
  .object({
    year: field,
    make: field,
    model: field,
    stock: field,
    row: field,
    date: field,
    photo: z.string().max(1000).nullable(),
  })
  .strict();
export type UtpapPhotoRow = z.infer<typeof UtpapPhotoRowSchema>;

export function utpapPhotoUrl(
  raw: string | null,
  code: UtpapYardCode,
  stock: string,
): string | null {
  let source: string | null;
  try {
    source = raw ? decodeEntities(raw) : null;
  } catch {
    return null;
  }
  const url = source ? URL.parse(source, UTPAP_ORIGIN) : null;
  const prefix = code === "1064" ? "Ogden" : "Orem";
  return url &&
    url.origin === UTPAP_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname === "/" + prefix + "-inventory-photos/" + stock + ".jpeg"
    ? url.href
    : null;
}

function decodeEntities(raw: string): string {
  const named = new Map([
    ["amp", "&"],
    ["lt", "<"],
    ["gt", ">"],
    ["quot", '"'],
    ["apos", "'"],
  ]);
  const value = raw.replace(/&([^;]+);/g, (entity: string, key: string) => {
    if (!key.startsWith("#")) {
      const replacement = named.get(key);
      if (replacement === undefined)
        throw new Error("Unknown Utah inventory entity " + entity);
      return replacement;
    }
    const point = /^#x[\da-f]+$/i.test(key)
      ? Number.parseInt(key.slice(2), 16)
      : /^#\d+$/.test(key)
        ? Number(key.slice(1))
        : NaN;
    if (
      !Number.isInteger(point) ||
      point <= 0 ||
      point > 0x10ffff ||
      (point >= 0xd800 && point <= 0xdfff)
    )
      throw new Error("Invalid Utah inventory character reference");
    return String.fromCodePoint(point);
  });
  return value.trim();
}
function decodeXml(raw: string): string {
  // HTML permits literal ampersands; the flat XML feed requires escaping.
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(raw))
    throw new Error("Unescaped Utah inventory ampersand");
  return decodeEntities(raw);
}

/** Only the provider's flat, un-attributed XML format is accepted. */
export function parseUtpapXml(raw: string, code: UtpapYardCode): UtpapRecord[] {
  if (raw.length > 5_000_000 || /<!|<\?(?!xml\b)/i.test(raw))
    throw new Error(
      "Utah inventory XML is oversized or has unsupported declarations",
    );
  const root =
    /^\s*<\?xml version="1\.0" standalone="yes"\?>\s*<INVENTORY>([\s\S]*)<\/INVENTORY>\s*$/.exec(
      raw,
    )?.[1];
  if (root === undefined)
    throw new Error("Utah inventory XML root is missing or truncated");
  const blocks = [...root.matchAll(/<ASSET>([\s\S]*?)<\/ASSET>/g)];
  if (
    blocks.length === 0 ||
    blocks.length > 10_000 ||
    root.replace(/<ASSET>[\s\S]*?<\/ASSET>/g, "").trim()
  )
    throw new Error(
      "Utah inventory XML contains empty, partial or unexpected assets",
    );
  const records = blocks.map((block) => {
    const body = block[1] ?? "";
    const children = [
      ...body.matchAll(
        /<([A-Za-z][A-Za-z0-9_]*)\s*\/>|<([A-Za-z][A-Za-z0-9_]*)>([^<]*)<\/\2>/g,
      ),
    ];
    if (
      body
        .replace(
          /<([A-Za-z][A-Za-z0-9_]*)\s*\/>|<([A-Za-z][A-Za-z0-9_]*)>([^<]*)<\/\2>/g,
          "",
        )
        .trim()
    )
      throw new Error("Utah inventory asset has partial or nested fields");
    const fields = children.map((child): [string, string] => [
      child[1] ?? child[2] ?? "",
      decodeXml(child[3] ?? ""),
    ]);
    if (new Set(fields.map(([key]) => key)).size !== fields.length)
      throw new Error("Utah inventory asset repeats a field");
    const record = UtpapRecordSchema.parse({
      VEHICLE_ROW: "",
      YARD_DATE: "",
      COLOR: "",
      ...Object.fromEntries(fields),
    });
    const yard = UTPAP_YARDS[code];
    if (
      record.S3CLIENTID !== code ||
      record.YARD_CITY !== yard.city.toUpperCase() ||
      record.YARD_NAME !== "UTAH PIC-A-PART " + yard.city.toUpperCase()
    )
      throw new Error("Utah inventory asset has contradictory yard ownership");
    return record;
  });
  if (new Set(records.map((r) => r.STOCKNUMBER)).size !== records.length)
    throw new Error("Utah inventory feed repeats a stock identity");
  return records;
}

const plain = (raw: string) =>
  decodeEntities(raw.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ");

export function parseUtpapMakes(raw: string): string[] {
  const clean = stripInventoryRawText(raw);
  const select =
    /<select\b[^>]*id="makeSelect"[^>]*>([\s\S]*?)<\/select>/i.exec(clean)?.[1];
  if (!select || !/<\/html>\s*$/i.test(raw) || raw.length > 2_000_000)
    throw new Error("Utah native make directory is missing or incomplete");
  const options = [...select.matchAll(/<option\b[^>]*>/gi)].map(([tag]) => {
    const value = inventoryHtmlAttribute(tag, "value");
    if (!value) throw new Error("Utah native make option has no value");
    return decodeEntities(value);
  });
  if (
    !options.length ||
    options.length > 200 ||
    new Set(options).size !== options.length
  )
    throw new Error(
      "Utah native make directory is empty, repeated or oversized",
    );
  return options;
}

export function parseUtpapMakePage(
  raw: string,
  code: UtpapYardCode,
  make: string,
): UtpapPhotoRow[] {
  if (raw.length > 2_000_000 || !/<\/html>\s*$/i.test(raw))
    throw new Error("Utah native inventory page is oversized or truncated");
  const clean = stripInventoryRawText(raw);
  const tables = [
    ...clean.matchAll(
      /<table\b[^>]*id="cars-table"[^>]*>([\s\S]*?)<\/table>/gi,
    ),
  ];
  const table = tables[0]?.[1];
  if (tables.length !== 1 || table === undefined || /<table\b/i.test(table))
    throw new Error("Utah native inventory table is missing or ambiguous");
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (table.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, "").trim())
    throw new Error("Utah native inventory table has partial rows");
  const headers = [
    ...(rows[0]?.[1] ?? "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi),
  ].map((m) => plain(m[1] ?? ""));
  if (
    JSON.stringify(headers) !==
    JSON.stringify([
      "Year",
      "Make",
      "Model",
      "Stock#",
      "Engine",
      "Vehicle Row",
      "Date Set",
      "Image",
    ])
  )
    throw new Error("Utah native inventory headings changed");
  const records = rows.slice(1).map((row) => {
    const body = row[1] ?? "";
    const cells = [...body.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (m) => m[1] ?? "",
    );
    if (
      cells.length !== 8 ||
      body.replace(/<td\b[^>]*>[\s\S]*?<\/td>/gi, "").trim()
    )
      throw new Error("Utah native inventory cell contract changed");
    const [
      year = "",
      nativeMake = "",
      model = "",
      stock = "",
      ,
      position = "",
      date = "",
    ] = cells.map(plain);
    if (nativeMake !== make)
      throw new Error("Utah native make search returned another make");
    const images = [...(cells[7] ?? "").matchAll(/<img\b[^>]*>/gi)];
    const links = [...(cells[7] ?? "").matchAll(/<a\b[^>]*>/gi)];
    const rawSource =
      images.length === 1
        ? inventoryHtmlAttribute(images[0]?.[0] ?? "", "src")
        : images.length === 0 && links.length === 1
          ? inventoryHtmlAttribute(links[0]?.[0] ?? "", "href")
          : null;
    const photo = utpapPhotoUrl(rawSource, code, stock);
    return { year, make: nativeMake, model, stock, row: position, date, photo };
  });
  if (new Set(records.map((r) => r.stock)).size !== records.length)
    throw new Error("Utah native make search repeats a stock");
  return records;
}

export function joinUtpapCatalog(
  records: readonly UtpapRecord[],
  photos: readonly UtpapPhotoRow[],
) {
  const byStock = new Map(photos.map((row) => [row.stock, row]));
  if (byStock.size !== photos.length || photos.length !== records.length)
    throw new Error("Utah XML and native photo catalog stock counts disagree");
  return records.map((record) => {
    const row = byStock.get(record.STOCKNUMBER);
    const date = record.YARD_DATE.slice(0, 10).split("-");
    if (
      !row ||
      row.year !== record.iYEAR ||
      row.make !== record.MAKE ||
      row.model !== record.MODEL
    )
      throw new Error(
        "Utah XML and native photo catalog disagree on donor " +
          record.STOCKNUMBER,
      );
    const position =
      row.row && record.VEHICLE_ROW && row.row !== record.VEHICLE_ROW
        ? ""
        : record.VEHICLE_ROW || row.row;
    const yardDate =
      row.date &&
      record.YARD_DATE &&
      row.date !== date[1] + "." + date[2] + "." + date[0]?.slice(2)
        ? ""
        : record.YARD_DATE;
    return {
      record: { ...record, VEHICLE_ROW: position, YARD_DATE: yardDate },
      photo: row.photo,
    };
  });
}
