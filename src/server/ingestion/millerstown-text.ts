/** Strict lexer for this source's PDF content streams, not a PDF file parser. */
type Atom =
  | { kind: "number"; value: number }
  | { kind: "name"; value: string }
  | { kind: "string"; value: string };
type Token =
  | Atom
  | { kind: "array"; value: Extract<Atom, { kind: "number" | "string" }>[] }
  | { kind: "mark"; value: string }
  | { kind: "operator"; value: string };
export type MillerstownTextObject = {
  font: string;
  size: number;
  matrix: number[];
  text: string;
};

function fail(reason: string): never {
  throw new Error(`Millerstown PDF content: ${reason}`);
}

function* lex(source: string): Generator<Token> {
  let offset = 0;
  const whitespace = (char: string) =>
    [0, 9, 10, 12, 13, 32].includes(char.charCodeAt(0));
  const delimiter = (char: string) =>
    whitespace(char) || "()<>[]{}/%".includes(char);
  const number = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
  const decoder = new TextDecoder("windows-1252", { fatal: true });
  function numeric(raw: string): number {
    const value = Number(raw);
    if (!Number.isFinite(value)) fail("non-finite numeric token");
    return value;
  }
  function skip() {
    while (offset < source.length) {
      if (whitespace(source.charAt(offset))) offset++;
      else if (source.charAt(offset) === "%") {
        while (offset < source.length && !/[\r\n]/.test(source.charAt(offset)))
          offset++;
      } else break;
    }
  }
  function literal(): string {
    offset++;
    let depth = 1;
    const bytes: number[] = [];
    while (offset < source.length) {
      let char = source.charAt(offset++);
      if (char === "\\") {
        if (offset >= source.length) fail("unterminated escape");
        char = source.charAt(offset++);
        if (/[0-7]/.test(char)) {
          let octal = char;
          while (octal.length < 3 && /[0-7]/.test(source.charAt(offset)))
            octal += source.charAt(offset++);
          bytes.push(parseInt(octal, 8) % 256);
        } else if (char === "\r" || char === "\n") {
          if (char === "\r" && source.charAt(offset) === "\n") offset++;
        } else {
          const escapes: Record<string, number> = {
            n: 10,
            r: 13,
            t: 9,
            b: 8,
            f: 12,
          };
          bytes.push(escapes[char] ?? char.charCodeAt(0));
        }
      } else if (char === "(") {
        depth++;
        bytes.push(40);
      } else if (char === ")") {
        if (--depth === 0) return decoder.decode(Uint8Array.from(bytes));
        bytes.push(41);
      } else if (char === "\r") {
        if (source.charAt(offset) === "\n") offset++;
        bytes.push(10);
      } else bytes.push(char.charCodeAt(0));
    }
    return fail("unterminated literal string");
  }
  function bare(): string {
    const start = offset;
    while (offset < source.length && !delimiter(source.charAt(offset)))
      offset++;
    if (start === offset) fail(`unexpected delimiter at byte ${offset}`);
    return source.slice(start, offset);
  }
  while (offset < source.length) {
    skip();
    if (offset >= source.length) break;
    const char = source.charAt(offset);
    if (char === "(") yield { kind: "string", value: literal() };
    else if (char === "/") {
      offset++;
      yield {
        kind: "name",
        value: bare().replace(/#([\da-f]{2})/gi, (_, hex: string) =>
          String.fromCharCode(parseInt(hex, 16)),
        ),
      };
    } else if (char === "[") {
      offset++;
      const value: Extract<Atom, { kind: "number" | "string" }>[] = [];
      while (true) {
        skip();
        if (offset >= source.length) fail("unterminated TJ array");
        if (source.charAt(offset) === "]") {
          offset++;
          break;
        }
        if (source.charAt(offset) === "(")
          value.push({ kind: "string", value: literal() });
        else {
          const raw = bare();
          if (!number.test(raw))
            fail("TJ accepts only literal strings and numeric kerning");
          value.push({ kind: "number", value: numeric(raw) });
        }
      }
      yield { kind: "array", value };
    } else if (
      source.slice(offset, offset + 2) === "<<" ||
      source.slice(offset, offset + 2) === ">>"
    ) {
      yield { kind: "mark", value: source.slice(offset, offset + 2) };
      offset += 2;
    } else {
      const raw = bare();
      yield number.test(raw)
        ? { kind: "number", value: numeric(raw) }
        : { kind: "operator", value: raw };
    }
  }
}

const graphics = new Set([
  "BMC",
  "BDC",
  "EMC",
  "q",
  "Q",
  "re",
  "W*",
  "n",
  "gs",
  "rg",
  "m",
  "l",
  "h",
  "f*",
  "g",
  "G",
  "w",
  "J",
  "j",
  "S",
]);

export function readMillerstownText(
  source: string,
  graphicsStates: ReadonlySet<string>,
): MillerstownTextObject[] {
  const result: MillerstownTextObject[] = [];
  let text: {
    font: string | null;
    size: number | null;
    matrix: number[] | null;
    shown: string | null;
  } | null = null;
  let operands: Token[] = [];
  let savedGraphics = 0;
  let markedContent = 0;
  for (const token of lex(source)) {
    if (token.kind !== "operator") {
      operands.push(token);
      continue;
    }
    const op = token.value;
    const numbers = operands.flatMap((value) =>
      value.kind === "number" ? [value.value] : [],
    );
    if (op === "BT") {
      if (text || operands.length) fail("nested or malformed BT");
      text = { font: null, size: null, matrix: null, shown: null };
    } else if (op === "ET") {
      if (
        !text ||
        operands.length ||
        text.font === null ||
        text.size === null ||
        text.matrix === null ||
        text.shown === null
      )
        fail("incomplete or unexpected ET");
      result.push({
        font: text.font,
        size: text.size,
        matrix: text.matrix,
        text: text.shown,
      });
      if (result.length > 100_000) fail("text-object count exceeds 100000");
      text = null;
    } else if (text) {
      const first = operands[0];
      if (
        op === "Tf" &&
        operands.length === 2 &&
        first?.kind === "name" &&
        numbers.length === 1 &&
        text.font === null
      ) {
        text.font = first.value;
        text.size = numbers[0] ?? null;
      } else if (
        op === "Tm" &&
        operands.length === 6 &&
        numbers.length === 6 &&
        text.matrix === null
      )
        text.matrix = numbers;
      else if (
        op === "TJ" &&
        operands.length === 1 &&
        first?.kind === "array" &&
        text.shown === null &&
        text.font !== null &&
        text.size !== null &&
        text.matrix !== null
      )
        text.shown = first.value
          .map((atom) => (atom.kind === "string" ? atom.value : ""))
          .join("");
      else if (
        (op === "g" || op === "G" || op === "Tc") &&
        operands.length === 1 &&
        numbers.length === 1
      ) {
        /* Source text color and character spacing do not change cell contents. */
      } else if (
        op === "gs" &&
        operands.length === 1 &&
        first?.kind === "name" &&
        graphicsStates.has(first.value)
      ) {
        /* Verified non-positioning graphics state. */
      } else fail(`unsupported or repeated text operator ${op}`);
    } else {
      if (!graphics.has(op))
        fail(`unsupported operator ${op} outside a text object`);
      const count: Readonly<Record<string, number>> = {
        re: 4,
        rg: 3,
        m: 2,
        l: 2,
        g: 1,
        G: 1,
        w: 1,
        J: 1,
        j: 1,
      };
      const expected = count[op];
      const first = operands[0];
      if (expected !== undefined) {
        if (operands.length !== expected || numbers.length !== expected)
          fail(`malformed graphics operator ${op}`);
      } else if (op === "gs") {
        if (
          operands.length !== 1 ||
          first?.kind !== "name" ||
          !graphicsStates.has(first.value)
        )
          fail("unknown or malformed graphics state");
      } else if (op === "BMC") {
        if (operands.length !== 1 || first?.kind !== "name")
          fail("malformed BMC");
        markedContent++;
      } else if (op === "BDC") {
        const [, open, key, id, close] = operands;
        if (
          operands.length !== 5 ||
          first?.kind !== "name" ||
          open?.kind !== "mark" ||
          open.value !== "<<" ||
          key?.kind !== "name" ||
          key.value !== "MCID" ||
          id?.kind !== "number" ||
          !Number.isSafeInteger(id.value) ||
          id.value < 0 ||
          close?.kind !== "mark" ||
          close.value !== ">>"
        )
          fail("malformed BDC");
        markedContent++;
      } else {
        if (operands.length) fail(`unexpected operands for ${op}`);
        if (op === "q") savedGraphics++;
        if (op === "Q" && --savedGraphics < 0)
          fail("unbalanced graphics state");
        if (op === "EMC" && --markedContent < 0)
          fail("unbalanced marked content");
      }
    }
    operands = [];
  }
  if (text || operands.length || savedGraphics || markedContent)
    fail("unconsumed or unterminated page content");
  return result;
}
