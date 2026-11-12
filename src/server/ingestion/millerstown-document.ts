import { inflateSync } from "node:zlib";
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFParser,
  PDFRawStream,
  PDFRef,
} from "pdf-lib";

const limits = {
  input: 8 * 1024 * 1024,
  stream: 1024 * 1024,
  decoded: 16 * 1024 * 1024,
  streams: 512,
  indirectObjects: 100_000,
  parsedValues: 1_000_000,
  rawIntegers: 200_000,
  depth: 64,
  objectStreamEntries: 1000,
  milliseconds: 20_000,
} as const;
type Budget = {
  failure: unknown;
  deadline: number;
  values: number;
  rawIntegers: number;
  streams: number;
  decoded: number;
  declaredObjects: number;
  objectNumbers: Set<number>;
  streamProof: {
    type: string;
    bytes: number;
    decodedBytes: number;
    objects: number;
  }[];
};
function requireBound(condition: boolean, reason: string): asserts condition {
  if (!condition) throw new Error(`Millerstown bounded PDF gate: ${reason}`);
}
const pdfWhitespace = (byte: number) => [0, 9, 10, 12, 13, 32].includes(byte);
function directInteger(dict: PDFDict, key: string, maximum: number): number {
  const value = dict.get(PDFName.of(key), true);
  requireBound(value instanceof PDFNumber, `${key} must be a direct integer`);
  const number = value.asNumber();
  requireBound(
    Number.isSafeInteger(number) && number >= 0 && number <= maximum,
    `${key} exceeds its integer bound`,
  );
  return number;
}
function directType(dict: PDFDict): string {
  const value = dict.get(PDFName.of("Type"), true);
  requireBound(
    value === undefined || value instanceof PDFName,
    "stream Type must be a direct name or absent",
  );
  return value?.decodeText() ?? "absent";
}

class Probe extends PDFParser {
  private depth = 0;
  constructor(
    bytes: Uint8Array,
    private readonly budget: Budget,
  ) {
    super(bytes, 100, true, true);
  }
  protected override matchKeyword(keyword: number[]): boolean {
    // Header lookahead catches parseRawInt errors. A resource failure is fatal
    // even when an inherited speculative parser tries to swallow it.
    if (this.budget.failure !== undefined) throw this.budget.failure;
    return super.matchKeyword(keyword);
  }
  protected override parseRawInt(): number {
    try {
      requireBound(
        ++this.budget.rawIntegers <= limits.rawIntegers,
        "integer work budget exceeded",
      );
      requireBound(
        performance.now() < this.budget.deadline,
        "20-second parse deadline exceeded",
      );
      const value = super.parseRawInt();
      requireBound(
        Number.isSafeInteger(value) && value >= 0 && value <= limits.input,
        "raw integer exceeds 8 MiB input/offset bound",
      );
      return value;
    } catch (cause) {
      this.budget.failure ??= cause;
      throw cause;
    }
  }
  override parseObject(): PDFObject {
    this.depth++;
    try {
      requireBound(this.depth <= limits.depth, "object nesting exceeds 64");
      requireBound(
        ++this.budget.values <= limits.parsedValues,
        "parsed-value budget exceeded",
      );
      requireBound(
        performance.now() < this.budget.deadline,
        "20-second parse deadline exceeded",
      );
      const object = super.parseObject();
      if (object instanceof PDFNumber)
        requireBound(
          Number.isFinite(object.asNumber()),
          "non-finite PDF number",
        );
      if (object instanceof PDFRef)
        requireBound(
          Number.isSafeInteger(object.objectNumber) &&
            object.objectNumber >= 0 &&
            object.objectNumber <= limits.indirectObjects &&
            Number.isSafeInteger(object.generationNumber) &&
            object.generationNumber >= 0 &&
            object.generationNumber <= 65535,
          "reference exceeds source bounds",
        );
      if (object instanceof PDFRawStream) return this.checkStream(object);
      return object;
    } catch (cause) {
      this.budget.failure ??= cause;
      throw cause;
    } finally {
      this.depth--;
    }
  }
  protected checkStream(_stream: PDFRawStream): PDFRawStream {
    throw new Error(
      "Millerstown bounded PDF gate: streams nested in compressed objects are unsupported",
    );
  }
  singleObject() {
    const object = this.parseObject();
    requireBound(
      object instanceof PDFDict || object instanceof PDFArray,
      "compressed source objects must be dictionaries or arrays",
    );
    // Comments at slice EOF could consume the next object in the parent parser.
    // Require only whitespace after a complete outer closing delimiter.
    requireBound(
      this.bytes
        .slice(this.bytes.offset(), Number.MAX_SAFE_INTEGER)
        .every(pdfWhitespace),
      "compressed object crosses its offset interval or has trailing content",
    );
  }
}

class BoundedDocumentParser extends Probe {
  constructor(
    bytes: Uint8Array,
    private readonly state: Budget,
  ) {
    super(bytes, state);
  }
  protected override checkStream(stream: PDFRawStream) {
    const dict = stream.dict;
    const raw = stream.getContents();
    requireBound(
      ++this.state.streams <= limits.streams,
      "raw-stream count exceeds 512",
    );
    requireBound(
      directInteger(dict, "Length", limits.input) === raw.length,
      "direct Length does not match raw stream bytes",
    );
    requireBound(
      dict.get(PDFName.of("DecodeParms"), true) === undefined,
      "DecodeParms are unsupported",
    );
    const filter = dict.get(PDFName.of("Filter"), true);
    requireBound(
      filter === undefined ||
        (filter instanceof PDFName && filter.decodeText() === "FlateDecode"),
      "only direct FlateDecode or no filter is supported",
    );
    const decoded =
      filter === undefined
        ? raw
        : inflateSync(raw, { maxOutputLength: limits.stream });
    requireBound(decoded.length <= limits.stream, "raw stream exceeds 1 MiB");
    this.state.decoded += decoded.length;
    requireBound(
      this.state.decoded <= limits.decoded,
      "aggregate decoded streams exceed 16 MiB",
    );
    const type = directType(dict);
    let objects = 0;
    if (type === "ObjStm") {
      // parseDictOrStream skips comments before looking for a following stream.
      // A comment at a declared interval boundary could consume the next object
      // in the inherited whole-stream parser. Native compressed objects contain
      // no percent bytes, so reject that entire ambiguous syntax conservatively.
      requireBound(
        !decoded.includes(37),
        "ObjStm percent/comment syntax is unsupported",
      );
      objects = directInteger(dict, "N", limits.objectStreamEntries);
      requireBound(objects > 0, "ObjStm N must be positive");
      const first = directInteger(dict, "First", 64 * 1024);
      requireBound(
        first > 0 && first < decoded.length,
        "ObjStm First outside decoded bytes",
      );
      this.state.declaredObjects += objects;
      requireBound(
        this.state.declaredObjects <= limits.indirectObjects,
        "aggregate ObjStm declarations exceed 100000",
      );
      const header = Buffer.from(decoded.subarray(0, first)).toString("latin1");
      requireBound(
        decoded
          .subarray(0, first)
          .every((byte) => (byte >= 48 && byte <= 57) || pdfWhitespace(byte)),
        "ObjStm header permits only integers and whitespace",
      );
      const pairs = header
        .replaceAll(String.fromCharCode(0), " ")
        .trim()
        .split(/[\t\n\f\r ]+/)
        .map(Number);
      requireBound(
        pairs.length === objects * 2 &&
          pairs.every((value) => Number.isSafeInteger(value) && value >= 0),
        "ObjStm header does not match N integer pairs",
      );
      let previous = -1;
      for (let index = 0; index < objects; index++) {
        const number = pairs[index * 2];
        const offset = pairs[index * 2 + 1];
        const next = pairs[(index + 1) * 2 + 1] ?? decoded.length - first;
        requireBound(
          number !== undefined &&
            number > 0 &&
            number <= limits.indirectObjects &&
            !this.state.objectNumbers.has(number),
          "ObjStm object numbers duplicate or exceed bounds",
        );
        requireBound(
          offset !== undefined &&
            offset > previous &&
            next > offset &&
            first + next <= decoded.length &&
            (index !== 0 || offset === 0),
          "ObjStm offsets overlap, are unordered or outside payload",
        );
        this.state.objectNumbers.add(number);
        previous = offset;
        new Probe(
          decoded.subarray(first + offset, first + next),
          this.state,
        ).singleObject();
      }
    } else if (type === "XRef") {
      const size = directInteger(dict, "Size", limits.indirectObjects);
      requireBound(
        size > 0 && dict.get(PDFName.of("Index"), true) === undefined,
        "XRef Size must be positive and Index is unsupported",
      );
      const widths = dict.get(PDFName.of("W"));
      requireBound(
        widths instanceof PDFArray && widths.size() === 3,
        "XRef W must be a direct three-integer array",
      );
      const expected = [1, 4, 2];
      for (let index = 0; index < 3; index++) {
        const value = widths.get(index);
        requireBound(
          value instanceof PDFNumber && value.asNumber() === expected[index],
          "XRef W must equal native [1,4,2]",
        );
      }
      requireBound(
        decoded.length === size * 7,
        "XRef decoded length does not equal Size times native entry width",
      );
    }
    this.state.streamProof.push({
      type,
      bytes: raw.length,
      decodedBytes: decoded.length,
      objects,
    });
    // Inherited ObjStm/XRef materialization receives only these already bounded
    // bytes. No second library decompressor touches the compressed input.
    const unfiltered = dict.clone();
    unfiltered.delete(PDFName.of("Filter"));
    unfiltered.set(PDFName.of("Length"), PDFNumber.of(decoded.length));
    return PDFRawStream.of(unfiltered, decoded);
  }
}

export async function parseMillerstownDocument(input: Uint8Array) {
  requireBound(
    input.length > 0 && input.length <= limits.input,
    "input must be 1 byte through 8 MiB",
  );
  // Buffer.slice aliases memory. Construct a plain owned byte copy before any yield.
  const bytes = new Uint8Array(input);
  const text = Buffer.from(bytes).toString("latin1");
  const eof = text.lastIndexOf("%%EOF");
  requireBound(
    /^%PDF-1\.[0-7]/.test(text) &&
      eof >= 0 &&
      bytes.subarray(eof + 5).every(pdfWhitespace),
    "missing PDF header or complete EOF",
  );
  const budget: Budget = {
    failure: undefined,
    deadline: performance.now() + limits.milliseconds,
    values: 0,
    rawIntegers: 0,
    streams: 0,
    decoded: 0,
    declaredObjects: 0,
    objectNumbers: new Set(),
    streamProof: [],
  };
  const context = await new BoundedDocumentParser(bytes, budget)
    .parseDocument()
    .catch((cause: unknown) => {
      throw budget.failure ?? cause;
    });
  if (budget.failure !== undefined) throw budget.failure;
  requireBound(
    context.enumerateIndirectObjects().length <= limits.indirectObjects &&
      context.largestObjectNumber <= limits.indirectObjects,
    "indirect-object context exceeds 100000",
  );
  return {
    context,
    proof: {
      parsedValues: budget.values,
      rawIntegers: budget.rawIntegers,
      rawStreams: budget.streams,
      decodedBytes: budget.decoded,
      declaredObjects: budget.declaredObjects,
      indirectObjects: context.enumerateIndirectObjects().length,
      streams: budget.streamProof,
    },
  };
}
