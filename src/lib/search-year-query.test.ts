import { expect, test } from "bun:test";
import { SearchYearQuery } from "./search-year-query";

for (const [input, query, range] of [
  ["2010-2014 Ford F-150", "Ford F-150", [2010, 2014]],
  ["2010-14 Ford F-150", "Ford F-150", [2010, 2014]],
  ["2010..2014 Ford F-150", "Ford F-150", [2010, 2014]],
  ["2010 - 2014 Ford F-150", "Ford F-150", [2010, 2014]],
  ["Ford 2012 F-150", "Ford F-150", [2012, 2012]],
  ["1998-02 Toyota 4Runner", "Toyota 4Runner", [1998, 2002]],
  ["2010-2014 2012-2016 Ford", "Ford", [2012, 2014]],
  ["2010 2012 Ford", "Ford", [2012, 2010]],
  ["1900", "", [1900, 1900]],
  ["  2010 .. 2014   BMW 3 Series  ", "BMW 3 Series", [2010, 2014]],
  ["2014-2010 Ford", "2014-2010 Ford", null],
  ["2014 - 2010 Ford", "2014 - 2010 Ford", null],
  ["2014-10 Ford", "2014-10 Ford", null],
  ["1899-2014 Ford", "1899-2014 Ford", null],
  ["2010-9999 Ford", "2010-9999 Ford", null],
  ["2010-1 Ford", "2010-1 Ford", null],
  ["2010-2014-2016 Ford", "2010-2014-2016 Ford", null],
  ["2010 - Ford", "2010 - Ford", null],
  ["2010/2014 Ford", "2010/2014 Ford", null],
  ["1FTFW1ET1BFA20101", "1FTFW1ET1BFA20101", null],
  ["20101234567890123", "20101234567890123", null],
  ["F-150 4Runner 300ZX 3 Series", "F-150 4Runner 300ZX 3 Series", null],
  ["Peugeot 2008", "Peugeot", [2008, 2008]],
  ['"2010 Ford"', '"2010 Ford"', null],
  ["2010 OR 2014 Ford", "2010 OR 2014 Ford", null],
  ["!2010 Ford", "!2010 Ford", null],
  ["-2010 Ford", "-2010 Ford", null],
] as const) {
  test(`plain year query: ${input}`, () => {
    expect(SearchYearQuery.parse(input)).toEqual({ query, range });
  });
}

test("emits numeric year bounds", () => {
  const parsed = SearchYearQuery.parse("2010-2014 Ford F-150");
  expect(SearchYearQuery.filters(parsed)).toBe("year >= 2010 AND year <= 2014");
});
