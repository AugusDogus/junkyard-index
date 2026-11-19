import { describe, expect, it, spyOn } from "bun:test";
import { millerstownPdfFixture } from "./millerstown-test-fixtures";
import { deflateSync } from "node:zlib";
import { PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import { parseMillerstownDocument } from "./millerstown-document";

const pdf = (dictionary: string, payload: Uint8Array, prefix = "") =>
  Buffer.concat([
    Buffer.from(
      `%PDF-1.5\n${prefix}1 0 obj\n<<${dictionary} /Length ${payload.length}>>\nstream\n`,
    ),
    payload,
    Buffer.from("\nendstream\nendobj\n%%EOF"),
  ]);
function objectStream(objects = ["<< /Published true >>\n", "[1 2 3]\n"]) {
  let offset = 0;
  const header = objects
    .map((object, index) => {
      const pair = `${index + 10} ${offset} `;
      offset += Buffer.byteLength(object);
      return pair;
    })
    .join("");
  return {
    decoded: Buffer.from(header + objects.join("")),
    dictionary: `/Type /ObjStm /N ${objects.length} /First ${header.length} /Filter /FlateDecode`,
  };
}
function fixture(dictionary?: string, content?: Uint8Array, prefix = "") {
  const good = objectStream();
  return pdf(
    dictionary ?? good.dictionary,
    deflateSync(content ?? good.decoded),
    prefix,
  );
}

describe("Millerstown bounded public parser proof", () => {
  it("fully preflights the trimmed native PDF and returns only unfiltered bounded streams", async () => {
    const result = await parseMillerstownDocument(
      await millerstownPdfFixture(),
    );
    expect(result.proof).toMatchObject({
      rawStreams: 21,
      decodedBytes: 873078,
      declaredObjects: 0,
      indirectObjects: 50,
    });
    for (const [, object] of result.context.enumerateIndirectObjects())
      if (object instanceof PDFRawStream) {
        expect(object.dict.has(PDFName.of("Filter"))).toBe(false);
        expect(
          object.dict.lookup(PDFName.of("Length"), PDFNumber).asNumber(),
        ).toBe(object.getContentsSize());
      }
  });
  it("accepts direct and escaped names and native dict/array compressed objects", async () => {
    for (const dictionary of [
      objectStream().dictionary,
      objectStream()
        .dictionary.replace("/ObjStm", "/Obj#53tm")
        .replace("/FlateDecode", "/Flate#44ecode"),
    ]) {
      const result = await parseMillerstownDocument(fixture(dictionary));
      expect(result.proof.declaredObjects).toBe(2);
      expect(result.proof.indirectObjects).toBe(2);
    }
  });
  it("copies Buffer input before asynchronous parser yields", async () => {
    const input = await millerstownPdfFixture();
    const pending = parseMillerstownDocument(input);
    input.fill(0);
    expect((await pending).proof.indirectObjects).toBe(50);
  });
  it("accepts a bounded unfiltered object stream", async () => {
    const good = objectStream();
    const result = await parseMillerstownDocument(
      pdf(good.dictionary.replace(" /Filter /FlateDecode", ""), good.decoded),
    );
    expect(result.proof.declaredObjects).toBe(2);
  });
  it("rejects indirect Type before inherited auto decode", async () => {
    await expect(
      parseMillerstownDocument(
        fixture(
          objectStream().dictionary.replace("/Type /ObjStm", "/Type 2 0 R"),
          undefined,
          "2 0 obj\n/ObjStm\nendobj\n",
        ),
      ),
    ).rejects.toThrow("Type must be a direct");
  });
  for (const filter of [
    "[/FlateDecode]",
    "[/ASCII85Decode /FlateDecode]",
    "/LZWDecode",
    "/RunLengthDecode",
    "/ASCIIHexDecode",
    "/ASCII85Decode",
    "/Fl",
    "null",
    "2 0 R",
  ])
    it(`rejects unsupported Filter ${filter}`, async () => {
      await expect(
        parseMillerstownDocument(
          fixture(
            objectStream().dictionary.replace(
              "/Filter /FlateDecode",
              `/Filter ${filter}`,
            ),
          ),
        ),
      ).rejects.toThrow("only direct FlateDecode");
    });
  for (const value of ["null", "<< /Predictor 12 >>", "2 0 R"])
    it(`rejects DecodeParms ${value}`, async () => {
      await expect(
        parseMillerstownDocument(
          fixture(`${objectStream().dictionary} /DecodeParms ${value}`),
        ),
      ).rejects.toThrow("DecodeParms are unsupported");
    });
  it("rejects indirect Length and mismatching direct Length without using fallback as a success", async () => {
    const valid = fixture();
    for (const replacement of ["/Length 2 0 R", "/Length 1"]) {
      const bytes = Buffer.from(
        valid.toString("latin1").replace(/\/Length \d+/, replacement),
        "latin1",
      );
      await expect(parseMillerstownDocument(bytes)).rejects.toThrow(
        replacement.includes("R")
          ? "Length must be a direct"
          : "Length does not match",
      );
    }
  });
  for (const type of ["ObjStm", "XRef"])
    it(`rejects ${type} decompression bomb before automatic decode`, async () => {
      await expect(
        parseMillerstownDocument(
          fixture(
            `/Type /${type} /Filter /FlateDecode`,
            Buffer.alloc(1024 * 1024 + 1, 32),
          ),
        ),
      ).rejects.toThrow();
    });
  for (const replacement of [
    "/N 0",
    "/N 1001",
    "/N -1",
    "/N 2.5",
    "/N 2 0 R",
    "/First 0",
    "/First 999999",
    "/First 2 0 R",
  ])
    it(`rejects ObjStm ${replacement}`, async () => {
      const dictionary = objectStream().dictionary.replace(
        replacement.startsWith("/N") ? /\/N \d+/ : /\/First \d+/,
        replacement,
      );
      await expect(
        parseMillerstownDocument(fixture(dictionary)),
      ).rejects.toThrow();
    });
  for (const decoded of [
    "10 0 11 0 <<>> <<>>",
    "10 0 10 5 <<>> <<>>",
    "10 0 11 2 <<>> <<>>",
    "10 1 11 6 <<>> <<>>",
    "10 0 11 99999 <<>> <<>>",
  ])
    it(`rejects duplicate overlapping unordered or excessive offsets ${decoded}`, async () => {
      await expect(
        parseMillerstownDocument(
          fixture(
            `/Type /ObjStm /N 2 /First ${decoded.indexOf("<<")} /Filter /FlateDecode`,
            Buffer.from(decoded),
          ),
        ),
      ).rejects.toThrow();
    });
  for (const objects of [
    ["123\n"],
    ["(text)\n"],
    ["<<>>% trailing"],
    ["<<>> <<>>"],
    ["<< /Length 1 >> stream\nx\nendstream\n"],
  ])
    it(`rejects unsupported compressed object ${objects}`, async () => {
      const source = objectStream(objects);
      await expect(
        parseMillerstownDocument(fixture(source.dictionary, source.decoded)),
      ).rejects.toThrow();
    });
  it("rejects excessive recursive object nesting before materialization", async () => {
    const source = objectStream(["[".repeat(70) + "]".repeat(70)]);
    await expect(
      parseMillerstownDocument(fixture(source.dictionary, source.decoded)),
    ).rejects.toThrow("nesting exceeds");
  });
  it("rejects a boundary comment that hides the next array opener before stream lookahead", async () => {
    const source = objectStream(["<<>>%", "[(\nstream\nABC\nendstream\n)]"]);
    await expect(
      parseMillerstownDocument(fixture(source.dictionary, source.decoded)),
    ).rejects.toThrow("percent/comment syntax");
  });
  it("accepts the native bounded xref form", async () => {
    expect(
      (
        await parseMillerstownDocument(
          fixture(
            "/Type /XRef /Size 1 /W [1 4 2] /Filter /FlateDecode",
            Buffer.alloc(7),
          ),
        )
      ).proof.rawStreams,
    ).toBe(1);
  });
  for (const dictionary of [
    "/Size 150001 /W [1 4 2]",
    "/Size -1 /W [1 4 2]",
    "/Size 1 0 R /W [1 4 2]",
    "/Size 1 /W [1 4 2] /Index [0 999999999]",
    "/Size 1 /W [1 4 2] /Index 2 0 R",
    "/Size 1 /W [1 999999999 2]",
    "/Size 1 /W [1 4]",
    "/Size 1 /W [1 4 2 0]",
    "/Size 1 /W 2 0 R",
    "/Size 1 /W [1 2 0 R 2]",
    "/Size 2 /W [1 4 2]",
  ])
    it(`rejects unsafe xref semantics ${dictionary}`, async () => {
      await expect(
        parseMillerstownDocument(
          fixture(
            `/Type /XRef ${dictionary} /Filter /FlateDecode`,
            Buffer.alloc(7),
          ),
        ),
      ).rejects.toThrow();
    });
  // The 2026-11-12 template needs 275,248 raw integers, mostly classic xref
  // entries. Two integers per entry put these documents either side of the bound.
  const xrefHeavy = (entries: number) => {
    const head = "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n";
    return Buffer.from(
      `${head}xref\n0 ${entries}\n${"0000000000 65535 f\r\n".repeat(entries)}` +
        `trailer\n<< /Size ${entries} /Root 1 0 R >>\nstartxref\n${head.length}\n%%EOF\n`,
      "latin1",
    );
  };
  it("admits the integer work of the current native template", async () => {
    const result = await parseMillerstownDocument(xrefHeavy(140_000));
    expect(result.proof.rawIntegers).toBeGreaterThan(275_248);
  });
  it("still bounds integer work beyond its headroom", async () => {
    await expect(parseMillerstownDocument(xrefHeavy(300_001))).rejects.toThrow(
      "integer work budget exceeded",
    );
  });
  it("enforces the time budget before parser progress", async () => {
    let calls = 0;
    const clock = spyOn(performance, "now").mockImplementation(() =>
      calls++ === 0 ? 0 : 20001,
    );
    try {
      await expect(parseMillerstownDocument(fixture())).rejects.toThrow(
        "deadline exceeded",
      );
    } finally {
      clock.mockRestore();
    }
  });
  it("rejects excessive input before document parsing", async () => {
    await expect(
      parseMillerstownDocument(new Uint8Array(8 * 1024 * 1024 + 1)),
    ).rejects.toThrow("8 MiB");
  });
  it("preserves a resource failure swallowed by indirect-header lookahead", async () => {
    await expect(
      parseMillerstownDocument(
        Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n999999999X\n%%EOF\n"),
      ),
    ).rejects.toThrow("raw integer exceeds");
  });
});
