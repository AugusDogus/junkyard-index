import { z } from "zod";
import { stripInventoryRawText } from "./inventory-html";
import {
  prattElements,
  prattAttribute,
  prattText,
  prattContinuation,
} from "./pratt-html";
const text = z.string().max(300);
export const BudgetRecordSchema = z
  .object({
    year: text,
    make: text,
    model: text,
    stock: text,
    row: text,
    vin: text,
    date: text,
  })
  .strict();
export type BudgetRecord = z.infer<typeof BudgetRecordSchema>;
export const BudgetPageSchema = z
  .object({
    make: z.string().max(100),
    updated: z.string().regex(/^\d{2}\/\d{2}\/\d{2}$/),
    makes: z.array(z.string().min(1).max(100)).min(1).max(100),
    models: z.record(z.array(z.string().min(1).max(100)).min(1).max(500)),
    records: z.array(BudgetRecordSchema).max(5000),
  })
  .strict();
export type BudgetPage = z.infer<typeof BudgetPageSchema>;
export function parseBudgetPage(raw: string, make: string): BudgetPage {
  const html = stripInventoryRawText(raw);
  if (
    new TextEncoder().encode(raw).length > 4 * 1024 * 1024 ||
    [/<html\b/gi, /<body\b/gi, /<\/body\s*>/gi, /<\/html\s*>/gi].some(
      (p) => [...html.matchAll(p)].length !== 1,
    ) ||
    !/<\/body\s*>\s*<\/html\s*>\s*$/i.test(html)
  )
    throw new Error("Budget native HTML is oversized or incomplete");
  const body = prattText(html);
  if (
    !body.includes("881 South 9th Street Winter Garden, Fl. 34787") ||
    !body.includes("407-656-4707")
  )
    throw new Error("Budget physical yard ownership changed");
  const maps = [...raw.matchAll(/\bvar modelMap = (\{[^\r\n]+\});/g)];
  let modelData: unknown;
  if (maps.length !== 1)
    throw new Error(
      "Budget independent native make/model map is absent or ambiguous",
    );
  modelData = JSON.parse(maps[0]?.[1] ?? "");
  const models = z
    .record(z.array(z.string().min(1).max(100)).min(1).max(500))
    .parse(modelData);
  const selectors = prattElements(
    html,
    "select",
    (t) => prattAttribute(t, "id") === "makeSelect",
  );
  if (selectors.length !== 1)
    throw new Error("Budget make directory is absent or ambiguous");
  const makes = prattElements(selectors[0]?.body ?? "", "option").map((o) => {
    const value = prattAttribute(o.tag, "value");
    if (!value || value !== prattText(o.body))
      throw new Error("Budget make label and query value disagree");
    return value;
  });
  if (
    new Set(makes).size !== makes.length ||
    JSON.stringify([...makes].sort()) !==
      JSON.stringify(Object.keys(models).sort())
  )
    throw new Error(
      "Budget native select and independent make/model map disagree",
    );
  const tables = prattElements(html, "table", (t) =>
    (prattAttribute(t, "class") ?? "").split(/\s+/).includes("resultsTable"),
  );
  const result = tables.filter(
    (t) => prattElements(t.body, "thead").length === 1,
  );
  if (result.length !== 1 || !result[0])
    throw new Error("Budget complete inventory table is absent or ambiguous");
  const table = result[0].body;
  const heads = prattElements(table, "thead");
  const headers = prattElements(heads[0]?.body ?? "", "th").map((c) =>
    prattText(c.body),
  );
  if (
    JSON.stringify(headers) !==
    JSON.stringify([
      "Year",
      "Make",
      "Model",
      "Stock#",
      "Row#",
      "VIN",
      "Yard Date",
    ])
  )
    throw new Error("Budget native table columns changed");
  // Native markup uses one tbody per donor. DataTables performs client paging;
  // there is no server page to skip or a short-page completion heuristic.
  const bodies = prattElements(table, "tbody");
  const records = bodies.flatMap((b) => {
    const rows = prattElements(b.body, "tr");
    if (rows.length !== 1) throw new Error("Budget donor tbody changed");
    return rows.map((r) => {
      const cells = prattElements(r.body, "td");
      if (cells.length !== 7 || [...r.body.matchAll(/<td\b/gi)].length !== 7)
        throw new Error("Budget donor cell structure changed");
      const labels = cells.map((c) => prattAttribute(c.tag, "data-label"));
      if (
        JSON.stringify(labels) !==
        JSON.stringify([
          "Year",
          "Make",
          "Model",
          "Stock#",
          "Row",
          "Vin",
          "Date",
        ])
      )
        throw new Error("Budget donor field labels changed");
      const values = cells.map((c) => prattText(c.body));
      return BudgetRecordSchema.parse({
        year: values[0],
        make: values[1],
        model: values[2],
        stock: values[3],
        row: values[4],
        vin: values[5],
        date: values[6],
      });
    });
  });
  if (
    [...table.matchAll(/<tr\b/gi)].length !== records.length + 1 ||
    prattContinuation(html).length
  )
    throw new Error(
      "Budget native inventory has unaccounted rows or server continuation",
    );
  if (
    (make && !makes.includes(make)) ||
    records.some(
      (r) => r.make !== make || !models[r.make]?.includes(r.model),
    ) ||
    (!make && records.length) ||
    (make && records.length === 0)
  )
    throw new Error(
      "Budget observed make/model is missing from the directory, disagrees with the requested partition or has unexpectedly collapsed",
    );
  const updates = [
    ...body.matchAll(/Vehicle Inventory Updated: (\d{2}\/\d{2}\/\d{2})/g),
  ];
  if (updates.length !== 1)
    throw new Error("Budget inventory update evidence is absent or ambiguous");
  return BudgetPageSchema.parse({
    make,
    makes,
    models,
    records,
    updated: updates[0]?.[1],
  });
}
