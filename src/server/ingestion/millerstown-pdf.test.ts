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
function content(document: PDFDocument, edit: (source: string) => string) {
  const page = document.getPages()[0];
  if (!page) throw new Error("Missing native first page");
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
  it("keeps a donor row when optional stock and color cells are absent", async () => {
    const records = await parseMillerstownPdf(
      await modified((document) =>
        content(document, (source) =>
          source
            .replace(
              /BT\s+\/F2 11\.04 Tf\s+1 0 0 1 52\.8 492\.94 Tm[\s\S]*?\bET\b/,
              "",
            )
            .replace(
              /BT\s+\/F2 11\.04 Tf\s+1 0 0 1 366\.41 492\.94 Tm[\s\S]*?\bET\b/,
              "",
            ),
        ),
      ),
    );
    expect(records).toHaveLength(1122);
    expect(records[0]?.raw).toMatchObject({
      stock: "",
      color: "",
      vin: "JH4DC4456YS013792",
    });
  }, 20_000);
  for (const [name, edit] of [
    [
      "moved native heading",
      (source: string) =>
        source.replace("124.46 506.02 Tm", "352.01 506.02 Tm"),
    ],
    [
      "unknown body column",
      (source: string) =>
        source.replace("1 0 0 1 52.8 492.94 Tm", "1 0 0 1 55.8 492.94 Tm"),
    ],
    [
      "missing interior row",
      (source: string) =>
        source.replace(/BT[\s\S]*?\bET\b/g, (block) =>
          block.includes("478.42 Tm") ? "" : block,
        ),
    ],
    [
      "duplicate body cell",
      (source: string) =>
        source.replace(
          /BT\s+\/F2 11\.04 Tf\s+1 0 0 1 52\.8 492\.94 Tm[\s\S]*?\bET\b/,
          (block) => block + "\n" + block,
        ),
    ],
  ] as const)
    it(`rejects ${name} as a whole source`, async () => {
      await expect(
        parseMillerstownPdf(
          await modified((document) => content(document, edit)),
        ),
      ).rejects.toThrow();
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
