import { expect, test } from "bun:test";
import { parseMichigantruckPage } from "./michigantruck-parser";
import {
  michigantruckTestPage,
  michigantruckTestRecord,
} from "./michigantruck-test-fixtures";

const records = Array.from({ length: 26 }, (_, index) =>
  michigantruckTestRecord(
    index + 1,
    index === 25 ? { condition: "Complete" } : {},
  ),
);
test("Michigan Truck parses prefixed headings, published SEO detail/photo/stock fields and explicit retail", () => {
  const first = parseMichigantruckPage(michigantruckTestPage(records, 1), 1);
  const last = parseMichigantruckPage(michigantruckTestPage(records, 2), 2);
  expect(first.total).toBe(26);
  expect(first.salvageTotal).toBe(25);
  expect(first.records[0]).toEqual(records[0]);
  expect(last.records[0]?.condition).toBe("Complete");
  expect(last.nextUrl).toBeNull();
});
test("Michigan Truck rejects scope, census, destination, condition and terminal drift", () => {
  const raw = michigantruckTestPage(records, 1);
  for (const changed of [
    raw.replace("</html>", ""),
    raw.replace("1-25 of 26", "1-24 of 26"),
    raw.replace('class="active"', 'class="other"'),
    raw.replace('class="filter-list"', 'class="current-filter-list"'),
    raw.replace("Salvage <div>25", "Salvage <div>24"),
    raw.replace("page_number=2", "page_number=2&make=Ford"),
    raw.replace(
      "Condition:</h6></div><div><p>Salvage",
      "Condition:</h6></div><div><p>Unknown",
    ),
    raw.replace(
      'href="https://michigantruck.com/truck-details/',
      'href="https://other.example/truck-details/',
    ),
  ])
    expect(() => parseMichigantruckPage(changed, 1)).toThrow();
});
test("Michigan Truck ignores malformed sidebar choices and nulls invalid optional metadata", () => {
  const optional = michigantruckTestPage(
    [
      michigantruckTestRecord(1, {
        stockNumber: "x".repeat(501),
        engine: "x".repeat(501),
      }),
    ],
    1,
  )
    .replace("Truck Delivery</p>", "&bogus;</p>")
    .replace("Cummins</p>", "&bogus;</p>");
  const parsed = parseMichigantruckPage(optional, 1);
  expect(parsed.records[0]?.stockNumber).toBeNull();
  expect(parsed.records[0]?.engine).toBeNull();
  const malformedSidebar = michigantruckTestPage(records, 1).replace(
    "<body>",
    '<body><a href="michigantruck.com/trucks/?f-condition=nw">Sidebar choice</a>',
  );
  expect(parseMichigantruckPage(malformedSidebar, 1).total).toBe(26);
});
