import { expect, test } from "bun:test";
import { hasHttpPaginationLink } from "./provider-http-pagination";

test.each([
  '</page/2>; rel="alternate next"',
  '</page/2>; rel="next alternate"',
  '</page/2>; rel="ALTERNATE LAST"',
  "</page/2>; rel='alternate prev'",
  "</page/2>; rel=first",
  '</wp-json/>; rel="https://api.w.org/", </page/2>; rel="alternate next"',
  '</page/2>; rel="alternate n\\ext"',
])("recognizes pagination in %s", (link) => {
  expect(hasHttpPaginationLink(new Headers({ Link: link }))).toBe(true);
});

test("allows WordPress discovery and ordinary non-pagination links", () => {
  expect(hasHttpPaginationLink(new Headers())).toBe(false);
  expect(
    hasHttpPaginationLink(
      new Headers({
        Link: '</wp-json/>; rel="https://api.w.org/", </locations/>; rel="canonical alternate"',
      }),
    ),
  ).toBe(false);
});
