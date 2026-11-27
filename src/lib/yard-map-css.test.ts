import { describe, expect, test } from "bun:test";
import {
  getYardMapFitCss,
  getYardMapView,
  projectYardLocation,
  type YardMapView,
} from "./yard-map-projection";

/**
 * A CSS math value: its type, its value in px, radians or a plain number,
 * and whether it depends on a relative unit such as `cqw`.
 */
type MathValue = {
  type: "number" | "length" | "angle";
  value: number;
  relative: boolean;
};

type MathContext = {
  /** The container's size, for `cqw` and `cqh`. */
  container: { width: number; height: number };
  /** Unregistered custom properties, which `var()` substitutes as text. */
  vars: Readonly<Record<string, string>>;
  /** Registered `<length>` properties, which compute to px. */
  lengths: Readonly<Record<string, number>>;
};

const MATH_FUNCTIONS = ["calc", "min", "max", "clamp", "tan", "atan2"];

/**
 * Evaluates a CSS math expression. It throws where CSS divides by anything
 * but a number: Safari before 26, Chrome before 140 and Firefox before 158
 * drop the whole declaration (MDN: calc typed division produces unitless
 * number), so on iOS 18 the map's fit would fall back to no scale or offset.
 * It also throws on a relative unit inside atan2, which Safari 18 resolves
 * wrong (atan2(100cqw - 88px, 164px) in a 300px container gives tan 0).
 */
function evaluateMath(source: string, context: MathContext): MathValue {
  const tokens =
    source.match(
      /-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[a-z%]*|--[\w-]+|[a-z][a-z\d-]*\(|[()+\-*/,]/gi,
    ) ?? [];
  let index = 0;
  const peek = () => tokens[index];
  const next = () => {
    const token = tokens[index++];
    if (token === undefined) throw new Error(`"${source}" ends early.`);
    return token;
  };
  const expect = (token: string) => {
    const actual = next();
    if (actual !== token)
      throw new Error(`"${source}" has ${actual} where ${token} belongs.`);
  };
  const same = (values: MathValue[], name: string) => {
    const types = new Set(values.map((value) => value.type));
    const [type] = types;
    if (types.size !== 1 || type === undefined)
      throw new Error(`${name} in "${source}" mixes ${[...types].join(", ")}.`);
    return type;
  };

  const sum = (): MathValue => {
    let left = product();
    while (peek() === "+" || peek() === "-") {
      const sign = next() === "+" ? 1 : -1;
      const right = product();
      left = {
        type: same([left, right], "A sum"),
        value: left.value + sign * right.value,
        relative: left.relative || right.relative,
      };
    }
    return left;
  };

  const product = (): MathValue => {
    let left = factor();
    while (peek() === "*" || peek() === "/") {
      const operator = next();
      const right = factor();
      if (operator === "/") {
        if (right.type !== "number")
          throw new Error(
            `"${source}" divides a ${left.type} by a ${right.type}.`,
          );
        left = {
          type: left.type,
          value: left.value / right.value,
          relative: left.relative || right.relative,
        };
      } else if (left.type === "number" || right.type === "number") {
        left = {
          type: left.type === "number" ? right.type : left.type,
          value: left.value * right.value,
          relative: left.relative || right.relative,
        };
      } else {
        throw new Error(`"${source}" multiplies two ${left.type}s.`);
      }
    }
    return left;
  };

  const args = (): MathValue[] => {
    const values = [sum()];
    while (peek() === ",") {
      next();
      values.push(sum());
    }
    expect(")");
    return values;
  };

  const factor = (): MathValue => {
    const token = next();
    if (token === "(") {
      const value = sum();
      expect(")");
      return value;
    }
    if (token === "var(") {
      const name = next();
      // Skip any fallback; the test gives every custom property.
      let depth = 1;
      while (depth > 0) {
        const skipped = next();
        if (skipped.endsWith("(")) depth++;
        if (skipped === ")") depth--;
      }
      const length = context.lengths[name];
      if (length !== undefined)
        return { type: "length", value: length, relative: false };
      const value = context.vars[name];
      if (value === undefined) throw new Error(`${name} has no test value.`);
      return evaluateMath(value, context);
    }
    if (token.endsWith("(")) {
      const name = token.slice(0, -1);
      const values = args();
      const [first, second, third] = values;
      const relative = values.some((value) => value.relative);
      if (name === "calc" && first && values.length === 1) return first;
      if (name === "min" || name === "max")
        return {
          type: same(values, name),
          value: Math[name](...values.map((value) => value.value)),
          relative,
        };
      if (name === "clamp" && first && second && third)
        return {
          type: same(values, name),
          value: Math.max(first.value, Math.min(second.value, third.value)),
          relative,
        };
      if (name === "atan2" && first && second && values.length === 2) {
        same(values, name);
        if (relative)
          throw new Error(`"${source}" has a relative unit inside atan2.`);
        return {
          type: "angle",
          value: Math.atan2(first.value, second.value),
          relative,
        };
      }
      if (name === "tan" && first && values.length === 1)
        return { type: "number", value: Math.tan(first.value), relative };
      throw new Error(`"${source}" calls ${name} in a way this test skips.`);
    }
    const match = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i.exec(
      token,
    );
    if (!match) throw new Error(`"${source}" has ${token} out of place.`);
    const amount = Number(match[1]);
    const unit = match[2] ?? "";
    if (unit === "") return { type: "number", value: amount, relative: false };
    if (unit === "px")
      return { type: "length", value: amount, relative: false };
    if (unit === "cqw")
      return {
        type: "length",
        value: (amount * context.container.width) / 100,
        relative: true,
      };
    if (unit === "cqh")
      return {
        type: "length",
        value: (amount * context.container.height) / 100,
        relative: true,
      };
    if (unit === "rad")
      return { type: "angle", value: amount, relative: false };
    if (unit === "deg")
      return {
        type: "angle",
        value: (amount * Math.PI) / 180,
        relative: false,
      };
    // Other lengths, and percentages, which resolve against a length here.
    return { type: "length", value: Number.NaN, relative: true };
  };

  const value = sum();
  if (index !== tokens.length)
    throw new Error(`"${source}" has ${peek()} after its value.`);
  return value;
}

/** Each top-level math function call in a declaration's value. */
function mathCalls(value: string): string[] {
  const calls: string[] = [];
  const pattern = new RegExp(`\\b(?:${MATH_FUNCTIONS.join("|")})\\(`, "g");
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    let depth = 0;
    let end = match.index + match[0].length - 1;
    do {
      if (value[end] === "(") depth++;
      if (value[end] === ")") depth--;
      end++;
    } while (depth > 0 && end < value.length);
    calls.push(value.slice(match.index, end));
    pattern.lastIndex = end;
  }
  return calls;
}

// Around 450 yards across the US, Alaska and Hawaii.
const yards = [
  { lat: 47.6, lng: -122.3 },
  { lat: 25.8, lng: -80.2 },
  { lat: 44.9, lng: -68.7 },
  { lat: 32.7, lng: -117.2 },
  { lat: 61.2, lng: -149.9 },
  { lat: 21.3, lng: -157.9 },
];
// The server's 900x400 guess, which the fit CSS corrects.
const drawn = getYardMapView(yards, 900, 400);

function fitVars(narrow: boolean): Record<string, string> {
  const fit = getYardMapFitCss(yards, drawn, narrow);
  return {
    "--yard-map-scale": fit.scale,
    "--yard-map-x": fit.x,
    "--yard-map-y": fit.y,
  };
}

/**
 * The fit CSS's context in a map this size: the container units, and the
 * container size the registered --yard-map-width and --yard-map-height give.
 */
function fitContext(width: number, height: number): MathContext {
  return {
    container: { width, height },
    vars: fitVars(width < 640),
    lengths: { "--yard-map-width": width, "--yard-map-height": height },
  };
}

/** Where the fit CSS puts the drawn map, as a scale and offset. */
function fitAt(width: number, height: number) {
  const context = fitContext(width, height);
  const scale = evaluateMath("var(--yard-map-scale)", context);
  const x = evaluateMath("var(--yard-map-x)", context);
  const y = evaluateMath("var(--yard-map-y)", context);
  expect([scale.type, x.type, y.type]).toEqual(["number", "length", "length"]);
  return { scale: scale.value, x: x.value, y: y.value };
}

/** The scale and offset that turn `drawn` into `target`. */
function expectedFit(target: YardMapView) {
  const unit = 2 ** (target.zoom - 2);
  const center = (view: YardMapView) =>
    projectYardLocation({ lat: view.center[0], lng: view.center[1] });
  const from = center(drawn);
  const to = center(target);
  return {
    scale: 2 ** (target.zoom - drawn.zoom),
    x: (from.x - to.x) * unit,
    y: (from.y - to.y) * unit,
  };
}

describe("yard map CSS", () => {
  for (const [width, height] of [
    [358, 285],
    [390, 300],
    [916, 512],
    [1408, 384],
  ] as const) {
    test(`the fit CSS frames a ${width}x${height} map like getYardMapView`, () => {
      const fit = fitAt(width, height);
      const expected = expectedFit(getYardMapView(yards, width, height));
      expect(fit.scale).toBeCloseTo(expected.scale, 9);
      expect(fit.x).toBeCloseTo(expected.x, 6);
      expect(fit.y).toBeCloseTo(expected.y, 6);
    });
  }

  test("the container size reaches the fit as registered lengths", async () => {
    const stylesheet = await Bun.file(
      new URL("../styles/globals.css", import.meta.url),
    ).text();
    for (const [name, value] of [
      ["--yard-map-width", "100cqw"],
      ["--yard-map-height", "100cqh"],
    ]) {
      expect(stylesheet).toMatch(
        new RegExp(`@property ${name} \\{[^}]*syntax: "<length>";`),
      );
      expect(stylesheet).toContain(`${name}: ${value};`);
    }
  });

  test("map styles never divide by a length, which Safari 18 drops", async () => {
    const stylesheet = await Bun.file(
      new URL("../styles/globals.css", import.meta.url),
    ).text();
    const declarations = [
      ...stylesheet.matchAll(/([^{}]*yard-map[^{}]*)\{([^{}]*)\}/g),
    ].flatMap(([, , body]) =>
      (body ?? "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(";")
        .map((declaration) => declaration.split(":").slice(1).join(":")),
    );
    const inline = await Promise.all(
      ["YardMapCanvas.tsx", "YardMapPinLayer.tsx", "YardMapPin.tsx"].map(
        (file) =>
          Bun.file(
            new URL(`../components/home/${file}`, import.meta.url),
          ).text(),
      ),
    );
    const literals = inline.flatMap((source) =>
      [...source.matchAll(/"([^"\n]*)"/g)].map(([, value]) => value ?? ""),
    );
    const calls = [...declarations, ...literals].flatMap(mathCalls);
    expect(calls.length).toBeGreaterThan(4);
    for (const width of [390, 1408]) {
      const context = fitContext(width, 384);
      for (const call of calls)
        expect(() => evaluateMath(call, context)).not.toThrow();
    }
  });
});
