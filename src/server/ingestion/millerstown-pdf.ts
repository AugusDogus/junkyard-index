import {
  PDFDict,
  PDFArray,
  PDFCatalog,
  PDFContext,
  PDFPageLeaf,
  PDFPageTree,
  PDFRef,
  PDFName,
  PDFNumber,
  PDFRawStream,
} from "pdf-lib";
import {
  readMillerstownText,
  type MillerstownTextObject,
} from "./millerstown-text";
import { parseMillerstownDocument } from "./millerstown-document";

export const MILLERSTOWN_PDF_LIMITS = {
  bytes: 8 * 1024 * 1024,
  pages: 128,
  objects: 150_000,
  rows: 10_000,
  pageDecodedBytes: 1024 * 1024,
  totalDecodedBytes: 16 * 1024 * 1024,
} as const;
// The 2026-11-12 Excel template prints body cells left-aligned at these starts.
const columns = [
  [52.44, "stock"],
  [106.7, "vin"],
  [231.62, "type"],
  [271.37, "make"],
  [314.57, "model"],
  [360.53, "year"],
  [409.25, "color"],
  [461.35, "trim"],
  [504.55, "engine"],
  [551.83, "transmission"],
  [592.39, "style"],
] as const;
type Column = (typeof columns)[number][1];
export type MillerstownRaw = Record<Column, string>;
export type MillerstownRecord = {
  raw: MillerstownRaw;
  provenance: { page: number; rowOnPage: number; baseline: number };
};
// The sheet's own header row. Sorting places it among the donors; exactly one
// must appear at the column starts, which proves the column semantics.
const headerText: MillerstownRaw = {
  stock: "Inventory",
  vin: "VIN",
  type: "Type",
  make: "Make",
  model: "Model",
  year: "Year",
  color: "Color",
  trim: "Trim",
  engine: "Engine",
  transmission: "Trans",
  style: "Style",
};
const layout = {
  fontSize: 11.28,
  firstBaseline: 544.08,
  rowPitch: 18.84,
  rowsPerPage: 26,
  // Cell starts vary by up to 0.12 points between source fonts.
  startTolerance: 0.15,
  // Excel nudges some numeric baselines within a row by up to 0.14 points.
  baselineTolerance: 0.25,
  // Excel right-aligns numeric cells. Their measured advance ends this far
  // before the next column's start. These are not nearest-column guesses.
  rightAlignedGap: 4.08,
  rightAlignedTolerance: 0.1,
} as const;

function requireFormat(condition: boolean, reason: string): asserts condition {
  if (!condition) throw new Error(`Millerstown PDF: ${reason}`);
}

function validPageBox(box: PDFArray | undefined): boolean {
  return (
    box !== undefined &&
    box.size() === 4 &&
    [0, 0, 792, 612].every(
      (value, index) => box.lookup(index, PDFNumber).asNumber() === value,
    )
  );
}

function sourcePages(context: PDFContext): PDFPageLeaf[] {
  const catalog = context.lookup(context.trailerInfo.Root);
  requireFormat(catalog instanceof PDFCatalog, "missing native PDF catalog");
  const pages: PDFPageLeaf[] = [];
  const seen = new Set<PDFPageLeaf | PDFPageTree>();
  function visit(
    node: PDFPageLeaf | PDFPageTree,
    parent: PDFPageTree | null,
    depth: number,
  ): number {
    requireFormat(
      depth <= 64 && !seen.has(node) && seen.size < 256,
      "cyclic, repeated or excessive page tree",
    );
    seen.add(node);
    const declaredParent = node.get(PDFName.of("Parent"), true);
    requireFormat(
      parent === null
        ? declaredParent === undefined
        : context.lookup(declaredParent) === parent,
      "page tree parent differs from its containing node",
    );
    if (node instanceof PDFPageLeaf) {
      pages.push(node);
      requireFormat(
        pages.length <= MILLERSTOWN_PDF_LIMITS.pages,
        "page count exceeds 128",
      );
      return 1;
    }
    const children = node.Kids();
    requireFormat(
      children.size() > 0 && children.size() <= 128,
      "empty or excessive page-tree children",
    );
    let count = 0;
    for (let index = 0; index < children.size(); index++) {
      const ref = children.get(index);
      requireFormat(
        ref instanceof PDFRef,
        "page-tree children must be indirect references",
      );
      const child = context.lookup(ref);
      requireFormat(
        child instanceof PDFPageLeaf || child instanceof PDFPageTree,
        "page-tree child has an unsupported type",
      );
      count += visit(child, node, depth + 1);
    }
    requireFormat(
      node.Count().asNumber() === count,
      "page-tree Count differs from enumerated leaves",
    );
    return count;
  }
  visit(catalog.Pages(), null, 0);
  requireFormat(
    pages.length > 0 &&
      context
        .enumerateIndirectObjects()
        .filter(([, object]) => object instanceof PDFPageLeaf).length ===
        pages.length,
    "empty catalog or unenumerated page objects",
  );
  return pages;
}

type FontWidths = (code: number) => number;

function fontWidths(
  context: PDFContext,
  resources: PDFDict,
  scope: string,
): Map<string, FontWidths> {
  const fonts = new Map<string, FontWidths>();
  // Trailing blank template pages carry no font resources.
  const dict = resources.lookupMaybe(PDFName.of("Font"), PDFDict);
  for (const [name, ref] of dict?.entries() ?? []) {
    const font = context.lookup(ref, PDFDict);
    // A direct WinAnsi encoding fixes every byte's meaning. Font family only
    // changes glyph shapes, so the template's mixed families are accepted.
    const encoding = font.get(PDFName.of("Encoding"));
    requireFormat(
      font.lookup(PDFName.of("Subtype"), PDFName).decodeText() === "TrueType" &&
        encoding instanceof PDFName &&
        encoding.decodeText() === "WinAnsiEncoding",
      `${scope} has an unsupported font or encoding`,
    );
    const first = font.lookup(PDFName.of("FirstChar"), PDFNumber).asNumber();
    const widths = font.lookup(PDFName.of("Widths"), PDFArray);
    fonts.set(name.decodeText(), (code) => {
      const index = code - first;
      requireFormat(
        index >= 0 && index < widths.size(),
        `${scope} shows a code without a declared glyph width`,
      );
      return widths.lookup(index, PDFNumber).asNumber();
    });
  }
  return fonts;
}

function cellColumn(
  object: MillerstownTextObject,
  x: number,
  widths: FontWidths,
): Column | undefined {
  const left = columns.find(
    ([start]) => Math.abs(start - x) < layout.startTolerance,
  );
  if (left) return left[1];
  if (!/^\d[\d.]*$/.test(object.text)) return undefined;
  const advance =
    object.codes.reduce(
      (sum, code) =>
        sum + (widths(code) / 1000) * object.size + object.charSpacing,
      0,
    ) -
    (object.adjustment / 1000) * object.size;
  const next = columns.findIndex(
    ([start]) =>
      Math.abs(start - layout.rightAlignedGap - (x + advance)) <
      layout.rightAlignedTolerance,
  );
  // The cell must also start inside the column it ends in.
  const owner = columns[next - 1];
  return owner !== undefined && owner[0] < x ? owner[1] : undefined;
}

export async function parseMillerstownPdf(
  bytes: Uint8Array,
): Promise<MillerstownRecord[]> {
  const { context } = await parseMillerstownDocument(bytes);
  requireFormat(
    context.trailerInfo.Encrypt === undefined,
    "encrypted documents are unsupported",
  );
  const pages = sourcePages(context);
  const records: MillerstownRecord[] = [];
  let headers = 0;
  let decodedTotal = 0;
  let lastTextPage: { page: number; rows: number } | null = null;
  for (const [index, page] of pages.entries()) {
    const pageNumber = index + 1;
    const scope = `page ${pageNumber}`;
    requireFormat(
      validPageBox(page.MediaBox()) &&
        (page.Rotate()?.asNumber() ?? 0) === 0 &&
        (page.CropBox() === undefined || validPageBox(page.CropBox())) &&
        page.get(PDFName.of("UserUnit"), true) === undefined,
      `${scope} has unsupported page dimensions or rotation`,
    );
    const stream = page.Contents();
    requireFormat(
      stream instanceof PDFRawStream,
      `${scope} needs exactly one raw content stream`,
    );
    const resources = page.Resources();
    requireFormat(resources instanceof PDFDict, `${scope} has no resources`);
    const fonts = fontWidths(context, resources, scope);
    const graphicsStates = new Set<string>();
    for (const [resource, ref] of resources
      .lookup(PDFName.of("ExtGState"), PDFDict)
      .entries()) {
      const state = context.lookup(ref, PDFDict);
      graphicsStates.add(resource.decodeText());
      for (const [key] of state.entries()) {
        const name = key.decodeText();
        requireFormat(
          ["Type", "BM", "ca", "CA"].includes(name),
          `${scope} has an unsupported graphics state`,
        );
        if (name === "Type" || name === "BM")
          requireFormat(
            state.lookup(key, PDFName).decodeText() ===
              (name === "Type" ? "ExtGState" : "Normal"),
            `${scope} has unsupported graphics state ${name}`,
          );
        else
          requireFormat(
            state.lookup(key, PDFNumber).asNumber() === 1,
            `${scope} has non-opaque graphics state`,
          );
      }
    }
    const decoded = stream.getContents();
    requireFormat(
      decoded.length <= MILLERSTOWN_PDF_LIMITS.pageDecodedBytes,
      `${scope} content exceeds 1 MiB`,
    );
    decodedTotal += decoded.length;
    requireFormat(
      decodedTotal <= MILLERSTOWN_PDF_LIMITS.totalDecodedBytes,
      "decoded pages exceed 16 MiB",
    );
    const objects = readMillerstownText(
      Buffer.from(decoded).toString("latin1"),
      graphicsStates,
    );
    if (objects.length === 0) {
      // The template pads its table with unfilled pages. Only a text page may
      // precede them, and no donor may follow them.
      requireFormat(
        lastTextPage !== null,
        `${scope} is blank before any inventory page`,
      );
      continue;
    }
    requireFormat(
      lastTextPage === null || lastTextPage.page === index,
      `${scope} has inventory after a blank page`,
    );
    requireFormat(
      lastTextPage === null || lastTextPage.rows === layout.rowsPerPage,
      `page ${index} is a partial page before the last inventory page`,
    );
    const rows = new Map<number, Partial<MillerstownRaw>>();
    for (const object of objects) {
      const [a, b, c, d, x, y] = object.matrix;
      requireFormat(
        x !== undefined && y !== undefined,
        `${scope} has incomplete text matrix`,
      );
      const widths = fonts.get(object.font);
      requireFormat(
        widths !== undefined &&
          object.size === layout.fontSize &&
          a === 1 &&
          b === 0 &&
          c === 0 &&
          d === 1,
        `${scope} has unsupported body text font or transform`,
      );
      const row = Math.round((layout.firstBaseline - y) / layout.rowPitch);
      requireFormat(
        row >= 0 &&
          row < layout.rowsPerPage &&
          Math.abs(layout.firstBaseline - row * layout.rowPitch - y) <
            layout.baselineTolerance,
        `${scope} has off-grid text at y=${y}`,
      );
      const column = cellColumn(object, x, widths);
      requireFormat(
        column !== undefined,
        `${scope} has unassigned text at x=${x}`,
      );
      const cells = rows.get(row) ?? {};
      requireFormat(
        cells[column] === undefined,
        `${scope} duplicates column ${column} in row ${row + 1}`,
      );
      cells[column] = object.text;
      rows.set(row, cells);
    }
    requireFormat(
      [...rows.keys()].every((row) => row < rows.size),
      `${scope} has a missing interior row`,
    );
    lastTextPage = { page: pageNumber, rows: rows.size };
    for (let row = 0; row < rows.size; row++) {
      const cells = rows.get(row) ?? {};
      const raw: MillerstownRaw = {
        stock: cells.stock ?? "",
        vin: cells.vin ?? "",
        type: cells.type ?? "",
        make: cells.make ?? "",
        model: cells.model ?? "",
        year: cells.year ?? "",
        color: cells.color ?? "",
        trim: cells.trim ?? "",
        engine: cells.engine ?? "",
        transmission: cells.transmission ?? "",
        style: cells.style ?? "",
      };
      if (JSON.stringify(raw) === JSON.stringify(headerText)) {
        headers++;
        continue;
      }
      records.push({
        raw,
        provenance: {
          page: pageNumber,
          rowOnPage: row + 1,
          baseline: Number(
            (612 - layout.firstBaseline + row * layout.rowPitch).toFixed(2),
          ),
        },
      });
      requireFormat(
        records.length <= MILLERSTOWN_PDF_LIMITS.rows,
        "row count exceeds 10000",
      );
    }
  }
  requireFormat(
    headers === 1,
    `expected exactly one column header row, found ${headers}`,
  );
  return records;
}
