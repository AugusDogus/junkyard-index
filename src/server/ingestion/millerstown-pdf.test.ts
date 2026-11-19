import { describe, expect, it } from "bun:test";
import { inflateSync } from "node:zlib";
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  degrees,
} from "pdf-lib";
import { parseMillerstownPdf } from "./millerstown-pdf";
import {
  millerstownOracleFixture,
  millerstownPdfFixture,
} from "./millerstown-test-fixtures";

async function modified(change: (document: PDFDocument) => void) {
  // The complete trusted binary is fingerprinted before test-only mutation.
  const document = await PDFDocument.load(await millerstownPdfFixture());
  change(document);
  return document.save({
    useObjectStreams: false,
    updateFieldAppearances: false,
  });
}
function content(
  document: PDFDocument,
  edit: (source: string) => string,
  pageIndex = 0,
) {
  const page = document.getPages()[pageIndex];
  if (!page) throw new Error(`Missing native page ${pageIndex + 1}`);
  const stream = page.node.Contents();
  if (!(stream instanceof PDFRawStream))
    throw new Error("Missing native raw content stream");
  const source = inflateSync(stream.getContents()).toString("latin1");
  page.node.set(
    PDFName.of("Contents"),
    document.context.register(document.context.flateStream(edit(source))),
  );
}

describe("Millerstown full PDF format controls", () => {
  it("preserves every row/cell through unchanged public-API reserialization", async () => {
    expect(await parseMillerstownPdf(await modified(() => {}))).toEqual(
      (await millerstownOracleFixture()).rawRecords,
    );
  }, 20_000);
  it("reads the sorted header row, right-aligned numbers, a second font and trailing blank pages", async () => {
    const records = await parseMillerstownPdf(await millerstownPdfFixture());
    expect(records).toHaveLength(421);
    expect(records.some(({ raw }) => raw.vin === "VIN")).toBe(false);
    expect(
      records
        .filter(({ raw }) => /^(?:1\.4|454)$/.test(raw.engine))
        .map(({ raw }) => raw.engine),
    ).toEqual(["1.4", "454", "454"]);
    expect(
      records.filter(({ raw }) => ["1784", "1412202500"].includes(raw.vin)),
    ).toHaveLength(2);
    expect(
      records.find(({ raw }) => raw.vin === "2CNFLFE51B6232881")?.raw,
    ).toMatchObject({ stock: "2604011", trim: "FWD", engine: "3.0 V6" });
    expect(records.at(-1)?.provenance).toEqual({
      page: 17,
      rowOnPage: 6,
      baseline: 162.12,
    });
  }, 20_000);
  it("keeps a donor row when optional stock and color cells are absent", async () => {
    const records = await parseMillerstownPdf(
      await modified((document) =>
        content(document, (source) =>
          source
            .replace(
              /BT\s+\/F1 11\.28 Tf\s+1 0 0 1 52\.44 543\.96 Tm[\s\S]*?\bET\b/,
              "",
            )
            .replace(
              /BT\s+\/F1 11\.28 Tf\s+1 0 0 1 409\.25 544\.08 Tm[\s\S]*?\bET\b/,
              "",
            ),
        ),
      ),
    );
    expect(records).toHaveLength(421);
    expect(records[0]?.raw).toMatchObject({
      stock: "",
      color: "",
      vin: "JH4DC4456YS013792",
    });
  }, 20_000);
  for (const [name, edit, page, message] of [
    [
      "missing sorted header row",
      (source: string) => source.replace("[(Color)] TJ", "[(Colour)] TJ"),
      0,
      "exactly one column header row",
    ],
    [
      "unknown body column",
      (source: string) =>
        source.replace("1 0 0 1 52.44 543.96 Tm", "1 0 0 1 55.44 543.96 Tm"),
      0,
      "unassigned text",
    ],
    [
      "right-aligned number off its column edge",
      (source: string) =>
        source.replace("1 0 0 1 529.03 544.08 Tm", "1 0 0 1 528.5 544.08 Tm"),
      11,
      "unassigned text",
    ],
    [
      "off-grid row",
      (source: string) =>
        source.replace("1 0 0 1 52.44 525.24 Tm", "1 0 0 1 52.44 530 Tm"),
      0,
      "off-grid text",
    ],
    [
      "missing interior row",
      (source: string) =>
        source.replace(/BT[\s\S]*?\bET\b/g, (block) =>
          block.includes(" 525.24 Tm") ? "" : block,
        ),
      0,
      "missing interior row",
    ],
    [
      "partial page before the last inventory page",
      (source: string) =>
        source.replace(/BT[\s\S]*?\bET\b/g, (block) =>
          block.includes(" 72.984 Tm") ? "" : block,
        ),
      0,
      "partial page before the last inventory page",
    ],
    [
      "unsupported body font size",
      (source: string) =>
        source.replace(
          "/F1 11.28 Tf\r\n1 0 0 1 52.44",
          "/F1 11.04 Tf\r\n1 0 0 1 52.44",
        ),
      0,
      "unsupported body text font or transform",
    ],
    [
      "duplicate body cell",
      (source: string) =>
        source.replace(
          /BT\s+\/F1 11\.28 Tf\s+1 0 0 1 52\.44 543\.96 Tm[\s\S]*?\bET\b/,
          (block) => block + "\n" + block,
        ),
      0,
      "duplicates column stock",
    ],
  ] as const)
    it(`rejects ${name} as a whole source`, async () => {
      await expect(
        parseMillerstownPdf(
          await modified((document) => content(document, edit, page)),
        ),
      ).rejects.toThrow(message);
    }, 20_000);
  for (const [name, change, message] of [
    [
      "inventory after a blank page",
      (document: PDFDocument) => {
        const last = document.getPages()[16];
        if (!last) throw new Error("Missing last inventory page");
        document.removePage(16);
        document.addPage(last);
      },
      "inventory after a blank page",
    ],
    [
      "a blank page before any inventory",
      (document: PDFDocument) => {
        const blank = document.getPages()[17];
        if (!blank) throw new Error("Missing blank template page");
        document.removePage(17);
        document.insertPage(0, blank);
      },
      "blank before any inventory page",
    ],
  ] as const)
    it(`rejects ${name}`, async () => {
      await expect(parseMillerstownPdf(await modified(change))).rejects.toThrow(
        message,
      );
    }, 20_000);
  for (const [name, change] of [
    [
      "rotation",
      (document: PDFDocument) =>
        document.getPages()[0]?.setRotation(degrees(90)),
    ],
    [
      "dimensions",
      (document: PDFDocument) => document.getPages()[0]?.setSize(612, 792),
    ],
    [
      "page tree count",
      (document: PDFDocument) =>
        document.catalog.Pages().set(PDFName.of("Count"), PDFNumber.of(1)),
    ],
    [
      "duplicate page",
      (document: PDFDocument) => {
        const first = document.getPages()[0];
        if (first) document.catalog.Pages().Kids().push(first.ref);
      },
    ],
    [
      "cyclic parent",
      (document: PDFDocument) => {
        const first = document.getPages()[0];
        if (first) first.node.set(PDFName.of("Parent"), first.ref);
      },
    ],
    [
      "multiple content streams",
      (document: PDFDocument) => {
        const first = document.getPages()[0];
        if (first)
          first.node.addContentStream(
            document.context.register(document.context.flateStream("")),
          );
      },
    ],
  ] as const)
    it(`rejects unsupported ${name}`, async () => {
      await expect(
        parseMillerstownPdf(await modified(change)),
      ).rejects.toThrow();
    }, 20_000);
});
