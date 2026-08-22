export interface RawCrushListing {
  year: number;
  make: string;
  model: string;
  color: string | null;
  reference: string | null;
  row: string | null;
  arrivalDate: string | null;
  yardId: number | null;
  yardName: string | null;
  sourceUrl: string;
}

export interface CrushMvcParseContext {
  sourceUrl: string;
  yardId: number | null;
  yardName: string | null;
}

type ListingField =
  | "year"
  | "make"
  | "model"
  | "color"
  | "reference"
  | "row"
  | "arrivalDate";

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:apos|#39);/gi, "'");
}

function cleanCellHtml(rawHtml: string): string {
  return decodeEntities(
    rawHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
  ).trim();
}

function normalizeColumnLabel(label: string): ListingField | null {
  const normalized = label
    .toUpperCase()
    .replace(/[^A-Z0-9# ]/g, " ")
    .trim();
  switch (normalized) {
    case "YEAR":
      return "year";
    case "MAKE":
      return "make";
    case "MODEL":
      return "model";
    case "COLOR":
      return "color";
    case "REFERENCE":
    case "STOCK #":
      return "reference";
    case "ROW":
      return "row";
    case "ARRIVAL DATE":
      return "arrivalDate";
    default:
      return null;
  }
}

function parseRowCells(rowHtml: string): string[] {
  const cells: string[] = [];
  const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let match: RegExpExecArray | null;
  while ((match = cellRegex.exec(rowHtml)) !== null) {
    cells.push(cleanCellHtml(match[1] ?? ""));
  }
  return cells;
}

function extractHeaderLabels(rowHtml: string): string[] {
  const labels: string[] = [];
  const headerRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
  let match: RegExpExecArray | null;
  while ((match = headerRegex.exec(rowHtml)) !== null) {
    labels.push(cleanCellHtml(match[1] ?? ""));
  }
  return labels;
}

function isHeaderRow(rowHtml: string): boolean {
  const labels = extractHeaderLabels(rowHtml).map((label) =>
    label.toUpperCase(),
  );
  return (
    labels.some((label) => label.includes("YEAR")) &&
    labels.some((label) => label.includes("MAKE"))
  );
}

function parseHeaderColumns(rowHtml: string): Array<ListingField | null> {
  return extractHeaderLabels(rowHtml).map((label) =>
    normalizeColumnLabel(label),
  );
}

export function normalizeCrushArrivalDate(rawValue: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(rawValue.trim());
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const month = Number.parseInt(match[1], 10);
  const day = Number.parseInt(match[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const monthPart = String(month).padStart(2, "0");
  const dayPart = String(day).padStart(2, "0");
  return `${match[3]}-${monthPart}-${dayPart}`;
}

function parseListingCells(
  cells: string[],
  columns: Array<ListingField | null>,
  context: CrushMvcParseContext,
): RawCrushListing | null {
  const values: Record<ListingField, string | null> = {
    year: null,
    make: null,
    model: null,
    color: null,
    reference: null,
    row: null,
    arrivalDate: null,
  };
  for (const [index, column] of columns.entries()) {
    if (!column) continue;
    const cell = cells[index];
    if (cell === undefined || cell === "") continue;
    values[column] = cell;
  }

  const year = Number.parseInt(values.year ?? "", 10);
  if (!Number.isFinite(year) || year < 1900 || year > 2100) return null;

  const make = values.make ?? "";
  const model = values.model ?? "";
  if (!make || !model) return null;

  return {
    year,
    make,
    model,
    color: values.color,
    reference: values.reference,
    row: values.row,
    arrivalDate: values.arrivalDate
      ? normalizeCrushArrivalDate(values.arrivalDate)
      : null,
    yardId: context.yardId,
    yardName: context.yardName,
    sourceUrl: context.sourceUrl,
  };
}

export function parseCrushInventoryHtml(
  html: string,
  context: CrushMvcParseContext,
): RawCrushListing[] {
  const listings: RawCrushListing[] = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let columns: Array<ListingField | null> | null = null;
  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(html)) !== null) {
    const rowHtml = match[1] ?? "";
    if (isHeaderRow(rowHtml)) {
      columns = parseHeaderColumns(rowHtml);
      continue;
    }
    if (!columns) continue;
    const listing = parseListingCells(parseRowCells(rowHtml), columns, context);
    if (listing) listings.push(listing);
  }
  return listings;
}
