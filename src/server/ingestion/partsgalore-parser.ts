import { Data, Effect } from "effect";
import {
  stripInventoryRawText,
  inventoryHtmlAttribute,
  inventoryTableSections,
} from "./inventory-html";

// One unpaginated catalog: 1,059 rows on 2026-09-15. Leave growth headroom,
// but fail rather than truncate if the single-checkpoint contract changes.
export const PARTSGALORE_MAX_CATALOG_RECORDS = 10_000;
export const PARTSGALORE_MAX_HTML_LENGTH = 5_000_000;

export interface PartsGaloreRecord {
  vin: string;
  year: string;
  make: string;
  model: string;
  color: string;
  yardDate: string;
  row: string;
  stockNumber: string;
}

export class PartsGaloreParseError extends Data.TaggedError(
  "PartsGaloreParseError",
)<{
  message: string;
}> {}

const tag = /<[^>"']*(?:"[^"]*"[^>"']*|'[^']*'[^>"']*)*>/g;
const namedEntities = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
  ["ndash", "\u2013"],
  ["mdash", "\u2014"],
  ["lsquo", "\u2018"],
  ["rsquo", "\u2019"],
  ["ldquo", "\u201c"],
  ["rdquo", "\u201d"],
]);

function fail(reason: string): never {
  throw new PartsGaloreParseError({
    message: `Parts Galore inventory: ${reason}. Inspect table #alldata at the public inventory URL before retrying; no catalog was accepted.`,
  });
}

function text(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(tag, "")
    .replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/gi, (_, entity: string) => {
      if (entity.startsWith("#")) {
        const hex = entity.slice(0, 2).toLowerCase() === "#x";
        const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
          return fail("invalid numeric HTML entity");
        return String.fromCodePoint(code);
      }
      return (
        namedEntities.get(entity.toLowerCase()) ??
        fail(`unsupported HTML entity &${entity};`)
      );
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** A deliberately narrow table grammar, not a browser's error-repair parser.
 * Explicit closing tags are required so a cut-off response cannot look complete.
 * Comments/raw-text elements are ignored before finding tables, rows or cells.
 */
function parse(html: string): (PartsGaloreRecord | null)[] {
  if (html.length > PARTSGALORE_MAX_HTML_LENGTH)
    fail("HTML exceeds the 5 MB character bound");
  const clean = stripInventoryRawText(html);
  const openings = [
    ...clean.matchAll(/<table\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi),
  ].filter(([opening]) => inventoryHtmlAttribute(opening, "id") === "alldata");
  const opening = openings[0];
  if (openings.length !== 1 || !opening)
    fail("expected exactly one table #alldata");
  const rest = clean.slice(opening.index + opening[0].length);
  const end = rest.search(/<\/table\s*>/i);
  if (end < 0) fail("unclosed inventory table");
  const table = rest.slice(0, end);
  const { head, body } = inventoryTableSections(table);
  function rows(sectionHtml: string) {
    const matches = [
      ...sectionHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi),
    ];
    if (matches.length * 2 !== [...sectionHtml.matchAll(/<\/?tr\b/gi)].length)
      fail("unclosed or nested inventory row");
    if (
      /<\/?(?:td|th)\b/i.test(
        sectionHtml.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi, ""),
      )
    )
      fail("inventory cells outside a row");
    return matches.map((match) => {
      const body = match[1] ?? "";
      const cells = [
        ...body.matchAll(
          /<(td|th)\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/\1\s*>/gi,
        ),
      ];
      if (cells.length * 2 !== [...body.matchAll(/<\/?(?:td|th)\b/gi)].length)
        fail("unclosed or nested inventory cell");
      if (
        cells.some((cell) => /\b(?:colspan|rowspan)\s*=/i.test(cell[2] ?? ""))
      )
        fail("spanning inventory cell changes the column contract");
      return cells.map((cell) => text(cell[3] ?? ""));
    });
  }
  const headers = rows(head);
  const header = headers[0];
  if (headers.length !== 1 || !header) fail("expected one header row");
  const names = header.map((value) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, ""),
  );
  if (new Set(names).size !== names.length) fail("ambiguous duplicate headers");
  for (const required of ["year", "make", "model", "vin"])
    if (!names.includes(required)) fail(`missing required ${required} header`);
  const records = rows(body);
  if (records.length === 0 || records.length > PARTSGALORE_MAX_CATALOG_RECORDS)
    fail(
      `received ${records.length} rows, expected 1-${PARTSGALORE_MAX_CATALOG_RECORDS}`,
    );
  return records.map((cells) => {
    if (cells.length !== names.length) return null;
    const value = (name: string) => cells[names.indexOf(name)] ?? "";
    return {
      vin: value("vin"),
      year: value("year"),
      make: value("make"),
      model: value("model"),
      color: value("color"),
      yardDate: value("yarddate"),
      row: value("row"),
      stockNumber: value("stocknumber") || value("stock"),
    };
  });
}

export function parsePartsGaloreCatalog(html: string) {
  return Effect.try({
    try: () => parse(html),
    catch: (cause) =>
      cause instanceof PartsGaloreParseError
        ? cause
        : new PartsGaloreParseError({
            message: `Parts Galore HTML parsing failed: ${String(cause)}`,
          }),
  });
}
