/** Strict lexer for this source's PDF content streams, not a PDF file parser. */
type Atom =
  | { kind: "number"; value: number }
  | { kind: "name"; value: string }
  | { kind: "string"; value: Uint8Array };
type Token =
  | Atom
  | { kind: "array"; value: Extract<Atom, { kind: "number" | "string" }>[] }
  | { kind: "mark"; value: string }
  | { kind: "operator"; value: string };
export type MillerstownTextObject = {
  font: string;
  size: number;
  /** Tc in effect when the text was shown, in unscaled text space units. */
  charSpacing: number;
  matrix: number[];
  text: string;
  /** Single-byte codes shown, for measuring the advance of right-aligned cells. */
  codes: number[];
  /** Sum of TJ position adjustments in thousandths of a text space unit. */
  adjustment: number;
};
/** Text state is part of the graphics state: it outlives ET and q/Q saves it. */
type TextState = {
  font: string | null;
  size: number | null;
  charSpacing: number;
};
const decoder = new TextDecoder("windows-1252", { fatal: true });

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
  function literal(): Uint8Array {
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
        if (--depth === 0) return Uint8Array.from(bytes);
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
  let state: TextState = { font: null, size: null, charSpacing: 0 };
  const saved: TextState[] = [];
  let text: {
    matrix: number[] | null;
    fontSet: boolean;
    spacingSet: boolean;
    shown: boolean;
  } | null = null;
  let operands: Token[] = [];
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
      text = { matrix: null, fontSet: false, spacingSet: false, shown: false };
    } else if (op === "ET") {
      if (!text || operands.length || !text.shown)
        fail("incomplete or unexpected ET");
      text = null;
    } else if (text) {
      const first = operands[0];
      const value = numbers[0];
      if (
        op === "Tf" &&
        operands.length === 2 &&
        first?.kind === "name" &&
        value !== undefined &&
        !text.fontSet &&
        !text.shown
      ) {
        text.fontSet = true;
        state = { ...state, font: first.value, size: value };
      } else if (
        op === "Tc" &&
        operands.length === 1 &&
        value !== undefined &&
        !text.spacingSet &&
        !text.shown
      ) {
        text.spacingSet = true;
        state = { ...state, charSpacing: value };
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
        !text.shown &&
        state.font !== null &&
        state.size !== null &&
        text.matrix !== null
      ) {
        text.shown = true;
        const codes = first.value.flatMap((atom) =>
          atom.kind === "string" ? [...atom.value] : [],
        );
        result.push({
          font: state.font,
          size: state.size,
          charSpacing: state.charSpacing,
          matrix: text.matrix,
          text: decoder.decode(Uint8Array.from(codes)),
          codes,
          adjustment: first.value.reduce(
            (sum, atom) => (atom.kind === "number" ? sum + atom.value : sum),
            0,
          ),
        });
        if (result.length > 100_000) fail("text-object count exceeds 100000");
      } else if (
        (op === "g" || op === "G") &&
        operands.length === 1 &&
        numbers.length === 1
      ) {
        /* Source text color does not change cell contents. */
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
        if (op === "q") saved.push(state);
        if (op === "Q") {
          const restored = saved.pop();
          if (restored === undefined) fail("unbalanced graphics state");
          state = restored;
        }
        if (op === "EMC" && --markedContent < 0)
          fail("unbalanced marked content");
      }
    }
    operands = [];
  }
  if (text || operands.length || saved.length || markedContent)
    fail("unconsumed or unterminated page content");
  return result;
}
