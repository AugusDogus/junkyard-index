import { expect, test } from "bun:test";
import { parseMidwayCatalog } from "./midway-parser";
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
