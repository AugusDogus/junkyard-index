import { expect, test } from "bun:test";
import {
  parseChesterfieldForm,
  parseChesterfieldInventory,
} from "./chesterfield-parser";

const form = `<form id="basic-search-form" method="post">
<select id="selected-make"><option value="298">HONDA</option><option value="287">FORD</option><option value="298">HONDA</option></select>
<select id="selected-model"><option selected value="5017">Accord</option><option value="5018">Civic</option></select>
<input name="BasicSearch.BeginYear" min="1962" max="2026" value="1962">
<input name="BasicSearch.EndYear" min="1962" max="2026" value="2026">
<input name="__RequestVerificationToken" value="public-form-test-state"></form>`;
const header =
  "<thead><tr>" +
  [
    "Pics",
    "Store",
    "Make",
    "Model",
    "Year",
    "Color",
    "Body",
    "Engine",
    "Yard Row",
    "Set",
  ]
    .map((h) => `<th>${h}</th>`)
    .join("") +
  "</tr></thead>";
const row = `<tr><td><button data-target="#HONDA1HGCB7669LA067658">Pics</button></td><td>Fort Lee</td><td>HONDA</td><td>Accord</td><td>1990</td><td>GOLD</td><td>Sedan</td><td>2.2L\n4cyl</td><td>Import 13 F</td><td>10/20/2026</td></tr>`;
const table = `<table>${header}<tbody>${row}</tbody></table>`;
const modal = `<div class="modal fade" id="HONDA1HGCB7669LA067658"><div class="modal-dialog"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">Images for Stock# 000000085373</h5></div><div class="modal-body"><img class="yard-veh-img" src="https://api.yardsmartapp.com/rails/active_storage/blobs/redirect/published-signed-id/image.jpg?keep=1&amp;sig=2"></div></div></div></div>`;
const page = (body = table + modal) =>
  `<html><body>${form}${body}</body></html>`;

test("reads source fields and binds VIN, genuine stock and signed photo through the same dialog", () => {
  expect(parseChesterfieldInventory(page())).toEqual([
    {
      yard: "Fort Lee",
      make: "HONDA",
      model: "Accord",
      year: "1990",
      color: "GOLD",
      body: "Sedan",
      engine: "2.2L 4cyl",
      position: "Import 13 F",
      arrivalDate: "10/20/2026",
      vin: "1HGCB7669LA067658",
      stock: "000000085373",
      images: [
        "https://api.yardsmartapp.com/rails/active_storage/blobs/redirect/published-signed-id/image.jpg?keep=1&sig=2",
      ],
    },
  ]);
});

test("deduplicates the native first make option and retains exact query bounds", () => {
  const result = parseChesterfieldForm(page(), {
    makeId: "298",
    modelId: "5017",
  });
  expect(result.makes).toEqual([
    { id: "298", label: "HONDA" },
    { id: "287", label: "FORD" },
  ]);
  expect(result.models).toHaveLength(2);
  expect(result.lower).toBe("1962");
  expect(result.upper).toBe("2026");
  expect(() =>
    parseChesterfieldForm(page(), { makeId: "287", modelId: "5017" }),
  ).toThrow("different");
});

test("missing photo dialogs never acquire invented VIN, stock or images", () => {
  const result = parseChesterfieldInventory(page(table));
  expect(result[0]?.stock).toBe("");
  expect(result[0]?.images).toEqual([]);
  // The native target still supplies the source VIN, even when its dialog is absent.
  expect(result[0]?.vin).toBe("1HGCB7669LA067658");
  const missing = parseChesterfieldInventory(
    page(table.replace(/<button[^>]*>Pics<\/button>/, "")),
  );
  expect(missing[0]?.vin).toBe("");
});

test("accepts an explicit native empty result only with the full result structure", () => {
  const emptyTable = `<table>${header}<tbody></tbody></table>`;
  expect(() => parseChesterfieldInventory(page(emptyTable))).toThrow(
    "no-matches",
  );
  expect(
    parseChesterfieldInventory(
      page(
        emptyTable +
          "<h2>Sorry, there aren&#x27;t any matches in our current yard vehicle inventory.</h2>",
      ),
    ),
  ).toEqual([]);
  expect(() =>
    parseChesterfieldInventory(
      page("there aren't any matches in our current yard vehicle inventory"),
    ),
  ).toThrow("tables");
});

test.each([
  page().replace("</html>", ""),
  page().replace("<th>Color</th>", "<th>Paint</th>"),
  page().replace("<td>GOLD</td>", ""),
  page().replace("</tr></tbody>", "</tbody>"),
  page().replace("</tbody>", ""),
  page().replace("</tbody>", "<td>orphan donor cell</td></tbody>"),
  page().replace("</div></div></div></div>", ""),
  page().replace("</body>", '<a rel="next" href="?page=2">Next</a></body>'),
  page().replace("</body>", '<nav class="pagination">Next</nav></body>'),
  page(table + modal + modal),
  page(`<table>${header}<tbody>${row.repeat(500)}</tbody></table>${modal}`),
])("rejects partial, changed, ambiguous and capped native results", (html) => {
  expect(() => parseChesterfieldInventory(html)).toThrow();
});

test.each([
  page().replace('value="1962"', 'value="2000"'),
  page().replace('name="__RequestVerificationToken"', 'name="other"'),
  page().replace(
    '<option value="298">HONDA</option>',
    '<option value="298">OTHER</option>',
  ),
  page().replace('method="post"', 'method="get"'),
  page().replace('value="5018"', 'selected value="5018"'),
])("rejects narrowed or contradictory form controls", (html) => {
  expect(() => parseChesterfieldForm(html)).toThrow();
});
