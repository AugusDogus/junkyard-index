import { expect, test } from "bun:test";
import { parseArmyCatalog } from "./army-parser";
import {
  armyTestPage,
  armyTestRecord,
  armyTestRow,
} from "./army-test-fixtures";

test("Army reads complete native inline donors and hidden identity without decoding unrelated footer entities", () => {
  expect(parseArmyCatalog(armyTestPage())).toEqual([armyTestRecord]);
});

test("Army decodes donor entities and permits an absent optional stock field", () => {
  const html = armyTestPage(
    armyTestRow({ ...armyTestRecord, model: "Town &amp; Country" }),
  ).replace(
    /<div class="mb-2"><span class="fw-bold">Stock Number: <\/span>[^<]*<\/div>/,
    "",
  );
  expect(parseArmyCatalog(html)[0]).toMatchObject({
    model: "Town & Country",
    stock: "",
  });
});

const changes: readonly (readonly [string, (body: string) => string])[] = [
  ["truncated document", (body) => body.replace("</html>", "")],
  ["missing tbody end", (body) => body.replace("</tbody>", "")],
  ["missing row end", (body) => body.replace("</tr></tbody>", "</tbody>")],
  ["missing cell end", (body) => body.replace("</td><td>BMW", "<td>BMW")],
  ["changed headings", (body) => body.replace("<th>Year</th>", "<th>Age</th>")],
  ["nested table", (body) => body.replace("<tbody>", "<tbody><table></table>")],
  [
    "empty inventory",
    (body) => body.replace(/<tbody>[\s\S]*?<\/tbody>/, "<tbody></tbody>"),
  ],
  ["changed ownership", (body) => body.replace("567.371.1244", "567.371.9999")],
  ["changed address", (body) => body.replace("1510 St.", "1511 St.")],
  [
    "changed donor scope",
    (body) =>
      body.replace(
        "largest and most up to date self service parts yard",
        "used car sales lot",
      ),
  ],
  [
    "wrong canonical",
    (body) =>
      body.replace(
        'rel="canonical" href="https://armysauto.com/self-service-inventory/"',
        'rel="canonical" href="https://armysauto.com/parts/"',
      ),
  ],
  [
    "selected make",
    (body) => body.replace('value="5">BMW', 'value="5" selected>BMW'),
  ],
  [
    "year range filter",
    (body) =>
      body.replace('value="1960" selected>1960', 'value="1980" selected>1980'),
  ],
  [
    "extra filter",
    (body) =>
      body.replace(
        '<form action="">',
        '<form action=""><input name="status" value="new">',
      ),
  ],
  [
    "pagination enabled",
    (body) => body.replace('data-pagination="false"', 'data-pagination="true"'),
  ],
  [
    "remote table",
    (body) =>
      body.replace(
        'data-pagination="false"',
        'data-pagination="false" data-url="/more"',
      ),
  ],
  [
    "duplicate pagination attribute",
    (body) =>
      body.replace(
        'data-pagination="false"',
        'data-pagination="false" data-pagination="true"',
      ),
  ],
  [
    "native continuation",
    (body) => body.replace("</body>", '<a href="?page=2">Next</a></body>'),
  ],
  [
    "inline server mode",
    (body) =>
      body.replace(
        "</body>",
        '<script>$(".bootstrap-tables").bootstrapTable({serverSide:true});</script></body>',
      ),
  ],
  [
    "changed script version",
    (body) => body.replace("yswp.js?ver=0.60", "yswp.js?ver=0.61"),
  ],
  ["unclosed raw script", (body) => body.replace("</body>", "<script></body>")],
  [
    "modal identity mismatch",
    (body) =>
      body.replace(
        'data-bs-target="#vehicleModal835"',
        'data-bs-target="#vehicleModal834"',
      ),
  ],
  ["missing VIN field", (body) => body.replace("VIN: ", "Identity: ")],
  [
    "duplicate VIN field",
    (body) =>
      body.replace(
        '<div class="modal-body">',
        '<div class="modal-body"><div><span>VIN: </span>WBXPA93465WD17483</div>',
      ),
  ],
  [
    "unclosed modal",
    (body) =>
      body.replace('</div><div id="vehicleImages', '<div id="vehicleImages'),
  ],
  [
    "identity outside its modal",
    (body) =>
      body
        .replace(
          '<div class="modal-body">',
          '</div></div></div><div class="modal-body">',
        )
        .replace("</div></div></div>\n    </td>", "\n    </td>"),
  ],
];
test.each(changes)("Army rejects %s", (_name, change) => {
  expect(() => parseArmyCatalog(change(armyTestPage()))).toThrow();
});

test("Army rejects repeated native IDs even if the canonical identity is unchanged", () => {
  expect(() =>
    parseArmyCatalog(armyTestPage(armyTestRow() + armyTestRow())),
  ).toThrow("native donor ID");
});

test("Army treats undecodable optional stock and color as absent", () => {
  expect(
    parseArmyCatalog(
      armyTestPage(
        armyTestRow({
          ...armyTestRecord,
          stock: "&unsupported;",
          color: "&#x110000;",
        }),
      ),
    )[0],
  ).toMatchObject({ stock: "", color: "", vin: armyTestRecord.vin });
});

test("Army rejects a boolean unknown table mode attribute", () => {
  expect(() =>
    parseArmyCatalog(
      armyTestPage().replace(
        'data-pagination="false"',
        'data-pagination="false" data-ajax',
      ),
    ),
  ).toThrow();
});

test("Army rejects HTML-encoded continuation query parameters", () => {
  expect(() =>
    parseArmyCatalog(
      armyTestPage().replace(
        "</body>",
        '<a href="/self-service-inventory/?sort=year&amp;page=2">Next</a></body>',
      ),
    ),
  ).toThrow("continuation");
});

test("Army nulls oversized optional scalars while retaining required field size guards", () => {
  const oversized = "A".repeat(301);
  expect(
    parseArmyCatalog(
      armyTestPage(
        armyTestRow({ ...armyTestRecord, stock: oversized, color: oversized }),
      ),
    )[0],
  ).toMatchObject({ stock: "", color: "", vin: armyTestRecord.vin });
  expect(() =>
    parseArmyCatalog(
      armyTestPage(armyTestRow({ ...armyTestRecord, model: oversized })),
    ),
  ).toThrow("field exceeds");
});
