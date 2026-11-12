import { z } from "zod";
import {
  inventoryHtmlAttribute,
  inventoryTableSections,
  stripInventoryRawText,
} from "./inventory-html";

const field = z.string().max(300);
export const ChesterfieldRecordSchema = z.object({
  yard: field,
  make: field,
  model: field,
  year: field,
  color: field,
  body: field,
  engine: field,
  position: field,
  arrivalDate: field,
  stock: field,
  vin: field,
  images: z.array(z.string().max(4096)).max(100),
});
export type ChesterfieldRecord = z.infer<typeof ChesterfieldRecordSchema>;
export const ChesterfieldQuerySchema = z.object({
  makeId: z.string().regex(/^[1-9]\d{0,5}$/),
  modelId: z.string().regex(/^[1-9]\d{0,5}$/),
});
export type ChesterfieldQuery = z.infer<typeof ChesterfieldQuerySchema>;

function decode(raw: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return raw.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (entity: string, key: string) => {
      if (!key.startsWith("#")) {
        const value = named[key.toLowerCase()];
        if (value === undefined)
          throw new Error("Unsupported Chesterfield entity " + entity);
        return value;
      }
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid Chesterfield character reference");
      return String.fromCodePoint(point);
    },
  );
}
const text = (raw: string) =>
  decode(raw.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
const attr = (tag: string, name: string) => {
  const value = inventoryHtmlAttribute(tag, name);
  return value === null ? null : decode(value);
};

function document(raw: string): string {
  if (Buffer.byteLength(raw) > 8_000_000 || !/<\/html\s*>\s*$/i.test(raw))
    throw new Error("Chesterfield HTML is oversized or truncated");
  return stripInventoryRawText(raw);
}

export function parseChesterfieldForm(
  raw: string,
  expected?: ChesterfieldQuery,
) {
  const html = document(raw);
  const forms = [
    ...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi),
  ].filter((match) => attr(match[1] ?? "", "id") === "basic-search-form");
  const form = forms[0];
  if (
    forms.length !== 1 ||
    !form?.[2] ||
    attr(form[1] ?? "", "method")?.toLowerCase() !== "post"
  )
    throw new Error("Chesterfield native POST form is missing or ambiguous");
  const formBody = form[2];
  const options = (id: string) => {
    const selects = [
      ...formBody.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select\s*>/gi),
    ].filter((match) => attr(match[1] ?? "", "id") === id);
    const body = selects[0]?.[2];
    if (selects.length !== 1 || !body)
      throw new Error("Missing Chesterfield selector " + id);
    const entries = [
      ...body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option\s*>/gi),
    ].map((match) => ({
      id: attr(match[1] ?? "", "value") ?? "",
      label: text(match[2] ?? ""),
      selected: inventoryHtmlAttribute(match[1] ?? "", "selected") !== null,
    }));
    if (
      !entries.length ||
      entries.some((e) => !/^\d{1,6}$/.test(e.id) || !e.label)
    )
      throw new Error("Invalid Chesterfield native selector options");
    const unique = new Map<string, string>();
    for (const entry of entries) {
      if (unique.has(entry.id) && unique.get(entry.id) !== entry.label)
        throw new Error(
          "Chesterfield selector repeats an ID with different labels",
        );
      unique.set(entry.id, entry.label);
    }
    const selected = entries.filter((e) => e.selected);
    if (selected.length > 1)
      throw new Error("Ambiguous Chesterfield selection");
    return {
      entries: [...unique]
        .filter(([id]) => id !== "0")
        .map(([id, label]) => ({ id, label })),
      selected: selected[0]?.id ?? entries[0]?.id,
    };
  };
  const makes = options("selected-make");
  const models = options("selected-model");
  if (
    expected &&
    (makes.selected !== expected.makeId || models.selected !== expected.modelId)
  )
    throw new Error(
      "Chesterfield returned a different native make/model selection",
    );
  const inputs = [...formBody.matchAll(/<input\b[^>]*>/gi)].map(([tag]) => tag);
  const input = (name: string) => {
    const matching = inputs.filter((tag) => attr(tag, "name") === name);
    if (matching.length !== 1 || !matching[0])
      throw new Error("Missing Chesterfield input " + name);
    return matching[0];
  };
  const first = input("BasicSearch.BeginYear");
  const last = input("BasicSearch.EndYear");
  const lower = attr(first, "min");
  const upper = attr(first, "max");
  if (
    !lower ||
    !upper ||
    !/^\d{4}$/.test(lower) ||
    !/^\d{4}$/.test(upper) ||
    Number(lower) < 1886 ||
    Number(upper) > 2100 ||
    Number(lower) >= Number(upper) ||
    attr(last, "min") !== lower ||
    attr(last, "max") !== upper ||
    attr(first, "value") !== lower ||
    attr(last, "value") !== upper
  )
    throw new Error(
      "Chesterfield search does not cover its declared year range",
    );
  const token = attr(input("__RequestVerificationToken"), "value");
  if (!token || token.length > 4096)
    throw new Error("Missing Chesterfield form verification token");
  return {
    makes: makes.entries,
    models: models.entries,
    selectedMake: makes.selected,
    selectedModel: models.selected,
    lower,
    upper,
    token,
  };
}

const headers = [
  "Pics",
  "Store",
  "Make",
  "Model",
  "Year",
  "Color",
  "Body",
  "Engine",
  "Yard Row",
  "Set",
];

/** Parse the complete native tables and their stock-bound donor photo dialogs. */
export function parseChesterfieldInventory(
  raw: string,
  tableCount: 1 | 3 = 1,
): ChesterfieldRecord[] {
  const html = document(raw);
  if (
    /<[^>]*\b(?:rel\s*=\s*["']?next\b|class\s*=\s*["'][^"']*\bpagination\b|data-page\b)/i.test(
      html,
    )
  )
    throw new Error("Chesterfield exposes unprocessed pagination");
  const tables = [
    ...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi),
  ].flatMap((match) => {
    const table = match[1] ?? "";
    const labels = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th\s*>/gi)].map(
      (m) => text(m[1] ?? ""),
    );
    return JSON.stringify(labels) === JSON.stringify(headers) ? [table] : [];
  });
  if (tables.length !== tableCount)
    throw new Error("Unexpected Chesterfield inventory tables or columns");
  const modalStarts = [...html.matchAll(/<div\b[^>]*>/gi)].filter(([tag]) =>
    (attr(tag, "class") ?? "").split(/\s+/).includes("modal"),
  );
  const modals = new Map<string, string>();
  for (const [index, match] of modalStarts.entries()) {
    const id = attr(match[0], "id");
    if (!id || modals.has(id))
      throw new Error("Missing or duplicate Chesterfield donor dialog ID");
    const chunk = html.slice(match.index, modalStarts[index + 1]?.index);
    // The native dialogs contain nested divs. Require a balanced modal root.
    let depth = 0;
    let end = 0;
    for (const tag of chunk.matchAll(/<\/?div\b[^>]*>/gi)) {
      depth += /^<\//.test(tag[0]) ? -1 : 1;
      if (depth === 0) {
        end = tag.index + tag[0].length;
        break;
      }
    }
    if (!end) throw new Error("Truncated Chesterfield donor dialog");
    modals.set(id, chunk.slice(0, end));
  }
  const records: ChesterfieldRecord[] = [];
  for (const table of tables) {
    const { body } = inventoryTableSections(table);
    const outsideRows = body.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi, "");
    if (/<\/?(?:tr|td|th)\b/i.test(outsideRows))
      throw new Error("Chesterfield has donor cells outside complete rows");
    const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
    if (rows.length >= 500)
      throw new Error("Chesterfield reached the 500-row completeness guard");
    if (rows.length !== [...body.matchAll(/<tr\b/gi)].length)
      throw new Error("Truncated Chesterfield donor row");
    for (const row of rows) {
      const cells = [
        ...(row[1] ?? "").matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi),
      ].map((m) => m[1] ?? "");
      if (
        cells.length !== headers.length ||
        cells.length !== [...(row[1] ?? "").matchAll(/<td\b/gi)].length
      )
        throw new Error("Unexpected Chesterfield donor cells");
      const [
        photoCell,
        yard,
        make,
        model,
        year,
        color,
        body,
        engine,
        position,
        arrivalDate,
      ] = cells.map(text);
      void photoCell;
      const buttons = [...(cells[0] ?? "").matchAll(/<button\b[^>]*>/gi)];
      if (buttons.length > 1)
        throw new Error("Ambiguous Chesterfield photo identity");
      const target = attr(buttons[0]?.[0] ?? "", "data-target") ?? "";
      const modal = modals.get(target.slice(1)) ?? "";
      const titles = [
        ...modal.matchAll(/<h5\b([^>]*)>([\s\S]*?)<\/h5\s*>/gi),
      ].filter((m) =>
        (attr(m[1] ?? "", "class") ?? "").split(/\s+/).includes("modal-title"),
      );
      if (titles.length > 1)
        throw new Error("Ambiguous Chesterfield stock title");
      const stock =
        /^Images for Stock#\s+(\d+)$/.exec(text(titles[0]?.[2] ?? ""))?.[1] ??
        "";
      records.push(
        ChesterfieldRecordSchema.parse({
          yard,
          make,
          model,
          year,
          color,
          body,
          engine,
          position,
          arrivalDate,
          stock,
          vin:
            make && target.startsWith("#" + make)
              ? target.slice(make.length + 1)
              : "",
          images: [...modal.matchAll(/<img\b[^>]*>/gi)].flatMap(([tag]) => {
            const src = attr(tag, "src");
            return (attr(tag, "class") ?? "")
              .split(/\s+/)
              .includes("yard-veh-img") && src
              ? [src]
              : [];
          }),
        }),
      );
    }
  }
  const explicitEmpty = [
    ...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/gi),
  ].some((m) =>
    text(m[1] ?? "").includes(
      "there aren't any matches in our current yard vehicle inventory",
    ),
  );
  if (records.length === 0 && !explicitEmpty)
    throw new Error(
      "Chesterfield empty table lacks the native no-matches confirmation",
    );
  return records;
}
