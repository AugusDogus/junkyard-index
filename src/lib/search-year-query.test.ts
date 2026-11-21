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
  // A leading two-digit year (people type "08 mustang").
  ["08 mustang", "mustang", [2008, 2008]],
  ["'08 Mustang", "Mustang", [2008, 2008]],
  ["98 civic", "civic", [1998, 1998]],
  ["86 Toyota pickup", "Toyota pickup", [1986, 1986]],
  ["98-02 civic", "civic", [1998, 2002]],
  ["'98-'02 civic", "civic", [1998, 2002]],
  ["05..07 Ford F-150", "Ford F-150", [2005, 2007]],
  // Two-digit numbers elsewhere are model names, not years.
  ["Toyota 86", "Toyota 86", null],
  ["mustang 08", "mustang 08", null],
  ["08", "08", null],
  ["08 2010 Ford", "08 Ford", [2010, 2010]],
  ["08-05 civic", "08-05 civic", null],
  ['"08 mustang"', '"08 mustang"', null],
] as const) {
  test(`plain year query: ${input}`, () => {
    expect(SearchYearQuery.parse(input)).toEqual({ query, range });
  });
}

test("emits numeric year bounds", () => {
  const parsed = SearchYearQuery.parse("2010-2014 Ford F-150");
  expect(SearchYearQuery.filters(parsed)).toBe("year >= 2010 AND year <= 2014");
});
