import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseMeeksInventory, parseMeeksOwner } from "./meeks-parser";

const fixture = (name: string) =>
  readFileSync(
    new URL(`./meeks-test-fixtures/${name}.html`, import.meta.url),
    "utf8",
  );

test("Meeks binds the VIN header despite duplicate native StockNumber td labels", () => {
  const page = parseMeeksInventory(fixture("inventory"));
  expect(page.records).toHaveLength(4);
  expect(page.records[0]).toEqual({
    year: "2014",
    make: "CHEVROLET",
    model: "CAPRICE",
    color: "WHITE",
    stock: "STK000118",
    vin: "6G3NS5U36EL982322",
    row: "105",
    arrival: "06/10/25",
    location: null,
    imageUrl:
      "https://meeksrecycling.com/vehicle_photos/6G3NS5U36EL982322_front.jpg",
  });
  expect(page.records[1]).toMatchObject({ year: "1977", vin: "CCY143F483883" });
  expect(page.records[2]?.vin).toBe("1FT7X2B67CEC0267");
  expect(page.records[3]?.imageUrl).toBeNull();
});

test("Meeks preserves the full inventory's extra native Location column", () => {
  const page = parseMeeksInventory(fixture("full-inventory"), "full");
  expect(page.records).toHaveLength(2);
  expect(page.records[0]).toMatchObject({
    vin: "1FMZU63E22ZA65206",
    location: "YARD",
    row: "106",
    arrival: "02/16/24",
  });
  expect(() => parseMeeksInventory(fixture("full-inventory"))).toThrow();
});

const boundaryChanges: readonly (readonly [
  string,
  (body: string) => string,
])[] = [
  ["truncated document", (body) => body.replace("</html>", "")],
  ["missing row closure", (body) => body.replace("</tr></tbody>", "</tbody>")],
  ["missing cell closure", (body) => body.replace("</td><td", "<td")],
  ["changed VIN header", (body) => body.replace("VIN #", "Part #")],
  [
    "extra cell",
    (body) => body.replace("</tr></tbody>", "<td>extra</td></tr></tbody>"),
  ],
  [
    "remote table",
    (body) => body.replace('"Info": true', '"ajax":"/more", "Info": true'),
  ],
  [
    "native continuation",
    (body) =>
      body.replace("</body>", '<a rel="next" href="?page=2">Next</a></body>'),
  ],
  ["nested table", (body) => body.replace("<tbody>", "<tbody><table></table>")],
  ["extra table", (body) => body.replace("</body>", "<table></table></body>")],
];
test.each(boundaryChanges)(
  "Meeks rejects %s before emitting records",
  (_name, change) => {
    expect(() => parseMeeksInventory(change(fixture("inventory")))).toThrow();
  },
);

test("Meeks treats malformed optional photo metadata as absent", () => {
  const body = fixture("inventory").replace(
    'href="/vehicle_photos/6G3NS5U36EL982322_front.jpg"',
    'href="https://other.example/vehicle_photos/front.jpg"',
  );
  expect(parseMeeksInventory(body).records[0]?.imageUrl).toBeNull();
});

test("Meeks discards unsupported optional section text without rejecting the donor", () => {
  const body = fixture("full-inventory").replace(
    'data-label="Row">YARD',
    'data-label="Row">&unsupported;',
  );
  expect(parseMeeksInventory(body, "full").records[0]?.location).toBe("");
});

test("Meeks owner binds the donor yard and published inventory destination", () => {
  expect(() => parseMeeksOwner(fixture("owner"))).not.toThrow();
  expect(() =>
    parseMeeksOwner(fixture("owner").replace("1205 Virginia", "1331 Virginia")),
  ).toThrow();
  for (const path of ["pic-and-pull/", "pic-and-pull-inventory/"])
    expect(() =>
      parseMeeksOwner(
        fixture("owner").replace(
          "https://meeksrecycling.com/" + path,
          "https://example.com/",
        ),
      ),
    ).toThrow();
});
