import { expect, test } from "bun:test";
import { parsePickapartvaPage } from "./pickapartva-parser";
import {
  pickapartvaTestPage,
  pickapartvaTestRecord,
} from "./pickapartva-test-fixtures";
import { pickapartvaTestRecords } from "./pickapartva-test-fixtures";

test("Pick-A-Part VA parses active native donors and explicit terminal pagination", () => {
  const page = parsePickapartvaPage(pickapartvaTestPage(), 1);
  expect(page.records).toEqual([pickapartvaTestRecord]);
  expect(page.lastPage).toBe(1);
  expect(page.nextUrl).toBeNull();
});

test("Pick-A-Part VA suppresses foreign optional photo binding without losing the donor", () => {
  const record = {
    ...pickapartvaTestRecord,
    imageUrl:
      "https://da8h1v3w8q6n5.cloudfront.net/tt87/images/PAP100000/PAP100000-1-photo.jpg",
  };
  const html = pickapartvaTestPage([record]).replace(
    'data-vstock-no="PAP100000"',
    'data-vstock-no="PAP999999"',
  );
  expect(parsePickapartvaPage(html, 1).records[0]?.imageUrl).toBeNull();
});

test.each([
  (html: string) => html.replace("</html>", ""),
  (html: string) => html.replace("9001 Patriot Hwy", "Unknown address"),
  (html: string) =>
    html.replace('name="search" value=""', 'name="search" value="Ford"'),
  (html: string) => html.replace("TT87,UU81", "TT87,UU81,UU82"),
  (html: string) =>
    html.replace('value="ANY" selected', 'value="TT87" selected'),
  (html: string) => html.replace("<b>Vin :</b>", "<b>Unknown :</b>"),
  (html: string) =>
    html.replace(
      "<b>Location: </b> Fredericksburg",
      "<b>Location: </b> Unknown",
    ),
  (html: string) => html.replace('id="PAP100000"', 'id="PAP999999"'),
  (html: string) =>
    html.replace("<b>Stock:</b>", "<b>Stock:</b> x<br><b>Stock:</b>"),
])(
  "Pick-A-Part VA rejects changed document/ownership/card contracts (%#)",
  (rewrite) => {
    expect(() =>
      parsePickapartvaPage(rewrite(pickapartvaTestPage()), 1),
    ).toThrow();
  },
);

test("Pick-A-Part VA consumes complete nonterminal pages and validates native current/Next links", () => {
  const html = pickapartvaTestPage(pickapartvaTestRecords(), 1, 2);
  expect(parsePickapartvaPage(html, 1).records).toHaveLength(500);
  expect(() =>
    parsePickapartvaPage(
      pickapartvaTestPage(pickapartvaTestRecords(499), 1, 2),
      1,
    ),
  ).toThrow();
  for (const changed of [
    html.replace('class="page-item active"', 'class="page-item"'),
    html.replaceAll("pagenum=2", "pagenum=3"),
    html.replace("Next »", "Hidden next"),
    html.replaceAll(
      "k=1&amp;id=ANY&amp;pagenum=2",
      "k=1&amp;id=TT87&amp;pagenum=2",
    ),
  ])
    expect(() => parsePickapartvaPage(changed, 1)).toThrow();
});

test("Pick-A-Part VA hashes donor/ownership/continuation data without volatile unrelated HTML", () => {
  const html = pickapartvaTestPage();
  expect(parsePickapartvaPage(html, 1).hash).toBe(
    parsePickapartvaPage(
      html.replace("</html>", "</html><!-- Cache counter 123 -->"),
      1,
    ).hash,
  );
  expect(
    parsePickapartvaPage(html.replace("2026-11-10", "2026-11-11"), 1).hash,
  ).not.toBe(parsePickapartvaPage(html, 1).hash);
});

test("Pick-A-Part VA rejects a source page narrowed to a selected make", () => {
  expect(() =>
    parsePickapartvaPage(
      pickapartvaTestPage().replace(
        '<option value="FORD">',
        '<option value="FORD" selected>',
      ),
      1,
    ),
  ).toThrow("make selector");
});

test("Pick-A-Part VA rejects an implicit first-make filter while retaining the native empty placeholder", () => {
  const html = pickapartvaTestPage().replace(
    '<option value="ANY">ANY</option><option value="FORD">FORD</option>',
    '<option value="FORD">FORD</option><option value="ANY">ANY</option>',
  );
  expect(() => parsePickapartvaPage(html, 1)).toThrow("make selector");
  expect(
    parsePickapartvaPage(
      pickapartvaTestPage().replace(
        '<select class="upullsimpleMake">',
        '<select class="upullsimpleMake"><option>Choose Make...</option>',
      ),
      1,
    ).records,
  ).toHaveLength(1);
});
