import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseMidwayCatalog, parseMidwayMakeDirectory } from "./midway-parser";
import { transformMidwayRecord } from "./midway-transform";
import {
  midwayTestPage,
  midwayTestRecord,
  midwayTestRow,
} from "./midway-test-fixtures";

test("Midway parses every inline donor with optional metadata absent", () => {
  const record = { ...midwayTestRecord, stock: "", row: "", arrived: "" };
  expect(
    parseMidwayCatalog(midwayTestPage(midwayTestRow(record)), "MO38"),
  ).toEqual([record]);
});

test("Midway accepts an inline view below the observed result ceiling", () => {
  const html = midwayTestPage(midwayTestRow(midwayTestRecord).repeat(499));
  expect(parseMidwayCatalog(html, "MO38")).toHaveLength(499);
});

test.each([500, 501])(
  "Midway rejects a saturated %i-row view before accepting completeness",
  (count) => {
    const html = midwayTestPage(midwayTestRow(midwayTestRecord).repeat(count));
    expect(() => parseMidwayCatalog(html, "MO38")).toThrow("500-row");
  },
);

const page = midwayTestPage();
test.each([
  page.replace("</html>", ""),
  page.replace("</tbody>", ""),
  page.replace("</tr></tbody>", "</tbody>"),
  page.replace(
    '<option value="MO38" selected>',
    '<option value="ANY" selected>',
  ),
  page.replace('name="id" value="MO38"', 'name="id" value="MO09"'),
  page.replace('name="search" value=""', 'name="search" value="2604445"'),
  page.replace("</form>", '<input name="limit" value="20"></form>'),
  page.replace(
    'data-search="true"',
    'data-search="true" data-side-pagination="server"',
  ),
  page.replace('data-search="true"', 'data-search="true" data-url="/partial"'),
  page.replace('data-search="true"', 'data-search="true" data-ajax'),
  page.replace(
    "</body>",
    '<a href="/inventory/ANY/ANY/?k=1&id=MO38&view=table&page=2">Next Page</a></body>',
  ),
  page.replace(
    "</body>",
    '<script>$(".IISUpullTable").bootstrapTable({sidePagination:"server"})</script></body>',
  ),
  page.replace("<tbody>", "<tbody><td>stray</td>"),
  page.replace("<th>Vin</th>", "<th>Plate</th>"),
  page.replace(
    "Some vehicles may not show parts available if we haven't parted them out yet.",
    "Retail vehicles",
  ),
  midwayTestPage(""),
])(
  "Midway rejects incomplete, filtered or ignored-yard catalogs (%#)",
  (html) => {
    expect(() => parseMidwayCatalog(html, "MO38")).toThrow();
  },
);

test("Midway ignores fake comment rows and accepts the native trailing cache comment", () => {
  const html =
    page.replace("<tbody>", "<tbody><!-- <tr><td>fake</td></tr> -->") +
    "<!-- cached -->";
  expect(parseMidwayCatalog(html, "MO38")).toEqual([midwayTestRecord]);
});

test("Midway does not decode unrelated footer entities as donor fields", () => {
  expect(
    parseMidwayCatalog(page.replace("</body>", "&times;</body>"), "MO38"),
  ).toEqual([midwayTestRecord]);
});

test.each(["&mdash;", "&hellip;", "&minus;"])(
  "Midway optional encoded missing values do not reject a complete donor (%s)",
  (placeholder) => {
    const [record] = parseMidwayCatalog(
      midwayTestPage(
        midwayTestRow({
          ...midwayTestRecord,
          stock: placeholder,
          row: placeholder,
          arrived: placeholder,
        }),
      ),
      "MO38",
    );
    expect(record).toBeDefined();
    if (!record) throw new Error("Expected parsed donor");
    expect(transformMidwayRecord(record, "MO38")).toMatchObject({
      status: "available",
      vehicle: { stockNumber: null, row: null, availableDate: null },
    });
  },
);

test("saved Tulsa response preserves all published make controls and remains outside admitted scope", () => {
  const html = gunzipSync(
    readFileSync(
      new URL("./midway-test-fixtures/tulsa-opening.html.gz", import.meta.url),
    ),
  ).toString("utf8");
  const directory =
    /<select\b[^>]*class="[^"]*upullsimpleMake[^"]*"[^>]*>([\s\S]*?)<\/select>/i.exec(
      html,
    )?.[1];
  if (!directory) throw new Error("Missing captured make directory");
  const values = [...directory.matchAll(/<option\b[^>]*value="([^"]*)"/gi)].map(
    (match) => match[1],
  );
  expect(values).toHaveLength(61);
  expect(new Set(values).size).toBe(60);
  expect(values.filter((value) => value === "NISSAN")).toHaveLength(2);
  expect([...new Set(values)].filter((value) => value !== "ANY")).toHaveLength(
    59,
  );
  const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(html)?.[1];
  if (!body) throw new Error("Missing captured donor body");
  expect([...body.matchAll(/<tr\b/gi)]).toHaveLength(500);
  expect(html).toContain("/cdn-cgi/challenge-platform/scripts/jsd/main.js");
  expect(() => parseMidwayCatalog(html, "MO38")).toThrow(
    "selected physical yard",
  );
  expect(() => parseMidwayCatalog(html, "MO09")).toThrow(
    "selected physical yard",
  );
});

test("the captured Tulsa menu enumerates each of its 59 distinct make controls once", () => {
  const html = gunzipSync(
    readFileSync(
      new URL("./midway-test-fixtures/tulsa-opening.html.gz", import.meta.url),
    ),
  ).toString("utf8");
  const makes = parseMidwayMakeDirectory(html, "OO95");
  expect(makes).toHaveLength(59);
  expect(makes.filter((make) => make === "NISSAN")).toEqual(["NISSAN"]);
  expect(makes).not.toContain("ANY");
  expect(() => parseMidwayCatalog(html, "OO95")).toThrow(
    "500-row result boundary",
  );
  expect(parseMidwayCatalog(html, "OO95", undefined, true)).toHaveLength(500);
});

test("make partitions enforce the published route, make identity and 500-row cap", () => {
  const html = midwayTestPage().replace(
    "/inventory/ANY/ANY/",
    "/inventory/CHRYSLER/ANY/",
  );
  expect(parseMidwayCatalog(html, "MO38", "CHRYSLER")).toEqual([
    midwayTestRecord,
  ]);
  expect(() => parseMidwayCatalog(html, "MO38", "FORD")).toThrow();
});
