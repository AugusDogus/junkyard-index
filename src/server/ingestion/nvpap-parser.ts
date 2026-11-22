import { z } from "zod";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import { NVPAP_RESULT_CAP, type NvpapYardCode } from "./nvpap-cursor";

const field = z.string().max(200);
const metadata = z
  .object({
    search_results: z
      .array(
        z.tuple([
          field,
          field,
          z.number().int().min(1886).max(2100),
          field,
          z.number().int(),
          z.number().int(),
        ]),
      )
      .max(NVPAP_RESULT_CAP),
  })
  .strict();

export interface NvpapRecord {
  make: string;
  model: string;
  year: number;
  vin: string;
  stock: string;
  color: string;
  row: string;
  date: string;
  images: readonly string[];
}

function decode(value: string): string {
  const named = new Map([
    ["amp", "&"],
    ["lt", "<"],
    ["gt", ">"],
    ["quot", '"'],
    ["apos", "'"],
    ["nbsp", " "],
  ]);
  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (entity: string, key: string) => {
      if (!key.startsWith("#")) {
        const result = named.get(key.toLowerCase());
        if (result === undefined)
          throw new Error("Unsupported Nevada inventory entity " + entity);
        return result;
      }
      const hex = key.slice(0, 2).toLowerCase() === "#x";
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid Nevada inventory character reference");
      return String.fromCodePoint(point);
    },
  );
}
function text(value: string): string {
  return decode(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** The native response is six digits, a newline, that many HTML characters,
 * then JSON. Treat both representations as one contract, never a partial page.
 */
export function parseNvpapPage(
  raw: string,
  yardCode: NvpapYardCode,
  year: number,
): NvpapRecord[] {
  if (raw.length > 2_000_000)
    throw new Error("Nevada inventory exceeds the 2 MB character bound");
  const prefix = /^(\d{6})\n/.exec(raw);
  if (!prefix?.[1])
    throw new Error("Nevada inventory length prefix is missing");
  const length = Number(prefix[1]);
  const markup = stripInventoryRawText(
    raw.slice(prefix[0].length, prefix[0].length + length),
  );
  const data = metadata.parse(JSON.parse(raw.slice(prefix[0].length + length)));
  if (
    !markup.startsWith('<div class="body-search-results">') ||
    !markup.endsWith("</div>") ||
    (data.search_results.length === 0 &&
      !markup.includes('<div class="body-search-results__empty">')) ||
    (data.search_results.length > 0 &&
      !markup.includes('<div class="products-body-search">'))
  )
    throw new Error(
      "Nevada inventory result wrapper or explicit empty state is missing",
    );
  let depth = 0;
  for (const [tag] of markup.matchAll(/<\/?div\b[^>]*>/gi)) {
    depth += /^<\//.test(tag) ? -1 : 1;
    if (depth < 0)
      throw new Error("Nevada inventory has unmatched closing markup");
  }
  if (depth !== 0) throw new Error("Nevada inventory is truncated");
  const chunks = markup
    .split(/(?=<div class="products-body-search__item"\s)/)
    .slice(1);
  if (chunks.length !== data.search_results.length)
    throw new Error("Nevada inventory HTML and JSON row counts disagree");
  const expectedStore = yardCode === "1074" ? "Las Vegas" : "Henderson";
  const records = data.search_results.map(
    ([make, model, sourceYear, vin, unlabeled, store], index) => {
      const chunk = chunks[index];
      if (
        !chunk ||
        !chunk.startsWith(
          '<div class="products-body-search__item" id="pt1-row-' + index + '">',
        )
      )
        throw new Error(
          "Nevada inventory row identity is missing or reordered",
        );
      const cellMatches = (name: string) => [
        ...chunk.matchAll(
          new RegExp(
            '<div class="products-body-search__' +
              name +
              '">([\\s\\S]*?)</div>',
            "g",
          ),
        ),
      ];
      const cell = (name: string, absentValue?: "") => {
        const matches = cellMatches(name);
        const value = matches[0]?.[1];
        if (matches.length === 0 && absentValue !== undefined)
          return absentValue;
        if (matches.length !== 1 || value === undefined)
          throw new Error(
            "Nevada inventory field is missing or duplicated: " + name,
          );
        return text(value);
      };
      const vins = [...chunk.matchAll(/<button\b[^>]*>/g)]
        .map(([tag]) => inventoryHtmlAttribute(tag, "data-pt1-vin"))
        .filter((value) => value !== null);
      // Native stock identifies yard ownership and broad/year control parity.
      // Its optional display contract does not relax this traversal identity.
      const stock = cell("stock");
      // Checks run lazily in order, so a later cell is read only after every
      // earlier check holds.
      const checks: readonly (readonly [string, () => boolean])[] = [
        ["JSON store id", () => store === Number(yardCode)],
        ["requested year", () => year === 0 || sourceYear === year],
        ["VIN button count", () => vins.length === 1],
        [
          "VIN button value",
          () => vins[0]?.trim().toUpperCase() === vin.trim().toUpperCase(),
        ],
        ["year cell", () => cell("year") === String(sourceYear)],
        [
          "model cell",
          () =>
            cell("model").toLowerCase() === (make + " " + model).toLowerCase(),
        ],
        ["store cell", () => cell("store") === expectedStore],
        ["stock format", () => /^[LH]\d{6}$/.test(stock)],
        [
          "stock yard prefix",
          () => stock.startsWith(yardCode === "1074" ? "L" : "H"),
        ],
      ];
      const failed = checks.find(([, holds]) => !holds());
      if (failed) {
        // Raw cell markup avoids a second decoding failure hiding this one.
        const raw = (name: string) =>
          JSON.stringify(
            cellMatches(name).map((match) => (match[1] ?? "").slice(0, 200)),
          );
        throw new Error(
          `Nevada inventory has contradictory yard, year, VIN, stock or model identity: row ${index} failed the ${failed[0]} check for store ${yardCode}, expecting ${expectedStore} and ${year === 0 ? "any year" : "year " + year}. ` +
            `JSON ${JSON.stringify({ make, model, year: sourceYear, vin, unlabeled, store })}; HTML cells stock ${raw("stock")}, year ${raw("year")}, model ${raw("model")}, store ${raw("store")}, VIN buttons ${JSON.stringify(vins)}. ` +
            "The whole page is rejected and the source run fails, so previously published Nevada inventory and the last validated checkpoint are preserved. " +
            "Compare this row with the native vehicle-stock response for the same store and year to decide whether the source data or the parser contract changed.",
        );
      }
      return {
        make: make.trim(),
        model: model.trim(),
        year: sourceYear,
        vin: vin.trim().toUpperCase(),
        stock,
        color: cell("color", ""),
        row: cell("row", ""),
        date: cell("date", ""),
        images: [...chunk.matchAll(/<img\b[^>]*>/g)].flatMap(([tag]) => {
          const src = inventoryHtmlAttribute(tag, "src");
          return src === null ? [] : [decode(src)];
        }),
      };
    },
  );
  if (new Set(records.map((r) => r.stock)).size !== records.length)
    throw new Error("Nevada inventory repeated a stock number");
  return records;
}

export function nvpapRecordKey(record: NvpapRecord): string {
  return record.stock + ":" + record.vin;
}
