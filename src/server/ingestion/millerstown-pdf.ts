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
import { readMillerstownText } from "./millerstown-text";
import { parseMillerstownDocument } from "./millerstown-document";

export const MILLERSTOWN_PDF_LIMITS = {
  bytes: 8 * 1024 * 1024,
  pages: 128,
  objects: 100_000,
  rows: 10_000,
  pageDecodedBytes: 1024 * 1024,
  totalDecodedBytes: 16 * 1024 * 1024,
} as const;
const columns = [
  [52.8, "stock"],
  [104.42, "vin"],
  [219.62, "type"],
  [248.69, "make"],
  [280.13, "model"],
  [332.33, "year"],
  [366.41, "color"],
  [409.97, "trim"],
  [444.67, "engine"],
  [484.15, "transmission"],
  [544.63, "style"],
  // The native report right-aligns these cells. They are not nearest-column guesses.
  [418.25, "trim"],
  [423.91, "trim"],
  [463.39, "engine"],
] as const;
type Column = (typeof columns)[number][1];
export type MillerstownRaw = Record<Column, string>;
export type MillerstownRecord = {
  raw: MillerstownRaw;
  provenance: { page: number; rowOnPage: number; baseline: number };
};
const headerText = [
  "Inventory",
  "VIN",
  "Type",
  "Make",
  "Model",
  "Year",
  "Color",
  "Trim",
  "Engine Size",
  "Trans Type",
  "Style",
];
const headerStarts = [
  72.864, 124.46, 239.69, 268.73, 300.17, 352.01, 386.45, 430.03, 464.71,
  504.19, 564.67,
];

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
  let decodedTotal = 0;
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
    const fontKinds = new Map<string, "body" | "heading">();
    for (const [name, ref] of resources
      .lookup(PDFName.of("Font"), PDFDict)
      .entries()) {
      const font = context.lookup(ref, PDFDict);
      const base = font
        .lookup(PDFName.of("BaseFont"), PDFName)
        .decodeText()
        .replace(/^[A-Z]{6}\+/, "");
      requireFormat(
        font.lookup(PDFName.of("Subtype"), PDFName).decodeText() ===
          "TrueType" &&
          font.lookup(PDFName.of("Encoding"), PDFName).decodeText() ===
            "WinAnsiEncoding" &&
          (base === "Calibri" || base === "Calibri-Bold"),
        `${scope} has an unsupported font or encoding`,
      );
      fontKinds.set(name.decodeText(), base === "Calibri" ? "body" : "heading");
    }
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
    const rows = new Map<number, Partial<MillerstownRaw>>();
    const headings: string[] = [];
    for (const object of objects) {
      const [a, b, c, d, x, y] = object.matrix;
      requireFormat(
        x !== undefined && y !== undefined,
        `${scope} has incomplete text matrix`,
      );
      const kind = fontKinds.get(object.font);
      if (kind === "heading") {
        const expectedX = headerStarts[headings.length];
        requireFormat(
          index === 0 &&
            expectedX !== undefined &&
            Math.abs(x - expectedX) < 0.005 &&
            object.size === 12 &&
            a === 0.70711 &&
            b === 0.70711 &&
            c === -0.70711 &&
            d === 0.70711 &&
            y === 506.02,
          `${scope} has unexpected rotated heading`,
        );
        headings.push(object.text);
        continue;
      }
      requireFormat(
        kind === "body" &&
          object.size === 11.04 &&
          a === 1 &&
          b === 0 &&
          c === 0 &&
          d === 1,
        `${scope} has unsupported body text transform`,
      );
      // 0.005 point tolerance covers printed numeric precision, not column inference.
      const column = columns.find(
        ([start]) => Math.abs(start - x) < 0.005,
      )?.[1];
      requireFormat(
        column !== undefined,
        `${scope} has unassigned text at x=${x}`,
      );
      const row = rows.get(y) ?? {};
      requireFormat(
        row[column] === undefined,
        `${scope} duplicates column ${column} at y=${y}`,
      );
      row[column] = object.text;
      rows.set(y, row);
    }
    requireFormat(
      JSON.stringify(headings) ===
        JSON.stringify(index === 0 ? headerText : []),
      `${scope} has missing, reordered or unexpected headers`,
    );
    const ordered = [...rows.entries()].sort(([a], [b]) => b - a);
    const fullCount = index === 0 ? 30 : 34;
    requireFormat(
      ordered.length > 0 &&
        ordered.length <= fullCount &&
        (index === pages.length - 1 || ordered.length === fullCount),
      `${scope} has incomplete or excessive row enumeration`,
    );
    let previous: number | null = null;
    for (const [rowIndex, [y, cells]] of ordered.entries()) {
      requireFormat(
        previous === null
          ? Math.abs(y - (index === 0 ? 492.94 : 546.6)) < 0.005
          : Math.abs(previous - y - 14.52) < 0.04,
        `${scope} has a missing or off-grid row at y=${y}`,
      );
      previous = y;
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
      records.push({
        raw,
        provenance: {
          page: pageNumber,
          rowOnPage: rowIndex + 1,
          baseline: Number((612 - y - 8.28).toFixed(3)),
        },
      });
      requireFormat(
        records.length <= MILLERSTOWN_PDF_LIMITS.rows,
        "row count exceeds 10000",
      );
    }
  }
  return records;
}
