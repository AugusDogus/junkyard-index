import { describe, expect, test } from "bun:test";
import { SearchCriteria } from "./search-criteria";
import {
  criteriaFromExpression,
  expressionFromCriteria,
} from "./search-expression-criteria";
import { parseExpression, serializeExpression } from "./search-expression";
const criteria = SearchCriteria.fromSavedSearch("Volvo", {
  minYear: 1963,
  maxYear: 2000,
});

describe("search expression", () => {
  test("preserves initial keyword and inclusive year boundaries", () => {
    const text = expressionFromCriteria(criteria);
    expect(text).toBe("Volvo AND year:>=1963 AND year:<=2000");
    const parsed = parseExpression(text);
    expect(parsed.success).toBe(true);
    if (parsed.success)
      expect(criteriaFromExpression(parsed.value, criteria)).toEqual(criteria);
  });
  test("exclusive year becomes the preceding inclusive year", () => {
    const parsed = parseExpression("make:Volvo year:<2000");
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const basic = criteriaFromExpression(parsed.value, criteria);
      expect(basic?.makes).toEqual(["Volvo"]);
      expect(basic?.yearRange[1]).toBe(1999);
    }
  });
  test("does not flatten cross-field OR or intersected makes", () => {
    for (const input of [
      "(make:Volvo state:Texas) OR (make:Saab state:Iowa)",
      "make:Volvo AND make:Saab",
    ]) {
      const parsed = parseExpression(input);
      expect(parsed.success).toBe(true);
      if (parsed.success)
        expect(criteriaFromExpression(parsed.value, criteria)).toBe(null);
    }
  });
  test("same-field alternatives convert to multiple selected values", () => {
    const parsed = parseExpression("(make:Volvo OR make:Saab) year:<2000");
    expect(parsed.success).toBe(true);
    if (parsed.success)
      expect(criteriaFromExpression(parsed.value, criteria)?.makes).toEqual([
        "Volvo",
        "Saab",
      ]);
  });
  test("builder serialization preserves quoted literals and escaped values", () => {
    for (const input of [
      '"-diesel"',
      '"make:Volvo"',
      '"AND"',
      'yard:"Augie\\\"s: west yard"',
    ]) {
      const parsed = parseExpression(input);
      expect(parsed.success).toBe(true);
      if (parsed.success)
        expect(parseExpression(serializeExpression(parsed.value))).toEqual(
          parsed,
        );
    }
  });
  test("invalid input is rejected without a success-shaped fallback", () => {
    for (const input of [
      'yard:"unfinished',
      "Ford OR",
      "year:twenty",
      "year:<20",
      "unknown:value",
      "(Ford OR Saab",
      "source:custom",
      "!",
      "Ford AND",
    ])
      expect(parseExpression(input).success).toBe(false);
  });
  test("empty nested groups do not produce dangling operators", () => {
    expect(
      serializeExpression({
        kind: "group",
        operator: "AND",
        children: [
          {
            kind: "condition",
            field: "make",
            comparison: "is",
            value: "Volvo",
          },
          { kind: "group", operator: "OR", children: [] },
        ],
      }),
    ).toBe("make:Volvo");
  });
});

test("Basic cannot silently clamp expression years outside its supported range", () => {
  for (const text of ["year:>=1886", "year:<=2050"]) {
    const parsed = parseExpression(text);
    expect(parsed.success).toBe(true);
    if (parsed.success)
      expect(criteriaFromExpression(parsed.value, criteria)).toBe(null);
  }
});
