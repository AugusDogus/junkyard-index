import { expect, test } from "bun:test";
import {
  parseRightwayCatalog,
  parseRightwayYard,
  validateRightwayPaginationScript,
} from "./rightway-parser";
import {
  rightwayTestHome,
  rightwayTestPage,
  rightwayTestRecord,
  rightwayTestRow,
  rightwayTestScript,
} from "./rightway-test-fixtures";

test("Rightway recovers each labeled anchor without merging implicit native cells", () => {
  expect(parseRightwayCatalog(rightwayTestPage())).toEqual([
    rightwayTestRecord,
  ]);
  expect(validateRightwayPaginationScript(rightwayTestScript)).toBeUndefined();
  expect(parseRightwayYard(rightwayTestHome)).toMatchObject({
    code: "decaturville",
    state: "TN",
  });
});

test("Rightway allows empty optional cells and decodes native text", () => {
  const record = {
    ...rightwayTestRecord,
    dateAdded: "",
    stock: "",
    color: "",
    make: "Land Rover",
    model: "Range & Rover",
  };
  const page = rightwayTestPage(rightwayTestRow(record)).replace(
    "Range & Rover",
    "Range &amp; Rover",
  );
  expect(parseRightwayCatalog(page)).toEqual([record]);
});

const page = rightwayTestPage();
test.each([
  page.replace("</html>", ""),
  page.replace("</tbody>", ""),
  page.replace("</tr></tbody>", "</tbody>"),
  page.replace("<tbody>", "<tbody><td>stray</td>"),
  page.replace('inventory_serial">VIN', 'inventory_serial">Serial'),
  page.replace('<td class="inventory_year">', '<td class="inventory_model">'),
  page.replace("wpinventory_loop_all ", ""),
  page.replace("wpinventoryitem-556", "wpinventoryitem-557"),
  page.replace("inventory_id=556", "inventory_id=557"),
  page.replace(
    "https://rightwayautorecycling.com/vehicle-search/?inventory_id=556",
    "https://other.example/vehicle-search/?inventory_id=556",
  ),
  page.replace("inventory_id=556", "inventory_id=556&amp;page=2"),
  page.replace("</body>", '<a rel="next" href="?paged=2">Next</a></body>'),
  page.replace("</body>", '<a href="?offset=100">More vehicles</a></body>'),
  page.replace("</body>", '<form name="wpinventory_filter"></form></body>'),
  page.replace(
    "</body>",
    '<script>jQuery("table.wpinventory_loop").DataTable({serverSide:true});</script></body>',
  ),
  page.replace("wpinventory.js?ver=2.5.10", "wpinventory.js?ver=3"),
  page.replace(
    "</body>",
    page.match(/<table\b[\s\S]*?<\/table>/)?.[0] + "</body>",
  ),
  rightwayTestPage(""),
])(
  "Rightway rejects partial, filtered or changed table contracts (%#)",
  (html) => {
    expect(() => parseRightwayCatalog(html)).toThrow();
  },
);

test("Rightway requires the inspected pagination code and verified active yard", () => {
  expect(() =>
    validateRightwayPaginationScript(rightwayTestScript + "\n"),
  ).toThrow("pagination");
  expect(() =>
    parseRightwayYard(rightwayTestHome.replace("731-549-3179", "731-549-0000")),
  ).toThrow();
  expect(() =>
    parseRightwayCatalog(
      page.replace(
        "check which parts are still available",
        "archived vehicles",
      ),
    ),
  ).toThrow();
});
