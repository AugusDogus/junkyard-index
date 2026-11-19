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
        charSpacing: 0,
        matrix: [1, 0, 0, 1, 104.42, 492.94],
        text: "TD Tj BT ET [still text]",
        codes: [...Buffer.from("TD Tj BT ET [still text]", "latin1")],
        adjustment: 12,
      },
    ]);
  });
  it("keeps text state across text objects until Q restores it", () => {
    const cell = (x: number) => `BT 1 0 0 1 ${x} 72.98 Tm [(1)-4(.)8(4)] TJ ET`;
    const result = readMillerstownText(
      `q BT /F1 11.28 Tf -0.0317 Tc 1 0 0 1 52.44 72.98 Tm [(A)] TJ ET ${cell(106.7)} Q`,
      states,
    );
    expect(
      result.map(({ font, size, charSpacing }) => ({
        font,
        size,
        charSpacing,
      })),
    ).toEqual([
      { font: "F1", size: 11.28, charSpacing: -0.0317 },
      { font: "F1", size: 11.28, charSpacing: -0.0317 },
    ]);
    expect(result[1]).toMatchObject({
      text: "1.4",
      codes: [49, 46, 52],
      adjustment: 4,
    });
    expect(() =>
      readMillerstownText(
        `q BT /F1 11.28 Tf 1 0 0 1 52.44 72.98 Tm [(A)] TJ ET Q ${cell(106.7)}`,
        states,
      ),
    ).toThrow("unsupported or repeated text operator TJ");
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
    text("(donor)").replace("Tm", "Tm /F2 11.04 Tf"),
    text("(donor)").replace("0 g", "0 Tc 1 Tc"),
    text("(donor)").replace("ET", "0 Tc ET"),
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
