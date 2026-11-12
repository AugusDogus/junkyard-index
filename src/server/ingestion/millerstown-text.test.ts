import { describe, expect, it } from "bun:test";
import { readMillerstownText } from "./millerstown-text";

const states = new Set(["GS9"]);
const text = (array: string) =>
  `BT /F2 11.04 Tf 1 0 0 1 104.42 492.94 Tm 0 g 0 G [${array}] TJ ET`;

describe("Millerstown source TJ lexer", () => {
  it("keeps operator-looking fragments and literal array boundaries inside strings", () => {
    const result = readMillerstownText(
      text("(TD)12( Tj BT ET [still text])"),
      states,
    );
    expect(result).toEqual([
      {
        font: "F2",
        size: 11.04,
        matrix: [1, 0, 0, 1, 104.42, 492.94],
        text: "TD Tj BT ET [still text]",
      },
    ]);
  });
  it("decodes nested parentheses, delimiters, octal, escapes and line continuations", () => {
    const result = readMillerstownText(
      text("(A(B)C\\(D\\)\\134\\101\\n\\\r\nZ)"),
      states,
    );
    expect(result[0]?.text).toBe("A(B)C(D)\\A\nZ");
  });
  for (const content of [
    "BT [(VIN)] TJ /F2 11.04 Tf 1 0 0 1 104.42 492.94 Tm ET",
    "BT /F2 11.04 Tf [(VIN)] TJ 1 0 0 1 104.42 492.94 Tm ET",
    text(`(VIN)${"9".repeat(310)}`),
    "BT /F2 11 Tf 1 0 0 1 1 1 Tm (donor) Tj ET",
    text("(donor)").replace("TJ", "TD"),
    text("(donor)").replace("ET", "1 1 Td ET"),
    text("(donor)").replace("ET", "[(extra)] TJ ET"),
    text("(unterminated"),
    text("<4142>"),
    "Q",
    "q",
    "EMC",
    "/P BMC",
    "/Missing gs",
    "1 0 0 1 0 0 cm",
  ])
    it(`rejects unsupported or malformed content ${content}`, () => {
      expect(() => readMillerstownText(content, states)).toThrow();
    });
});
