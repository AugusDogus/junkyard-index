import { expect, test } from "bun:test";
import {
  millerstownPdfUrl,
  parseMillerstownInventory,
  parseMillerstownRoot,
} from "./millerstown-parser";
import {
  MILLERSTOWN_FIXTURE_PDF_URL,
  millerstownHtmlFixture,
} from "./millerstown-test-fixtures";

test("native pages prove the same physical owner and one complete published PDF", async () => {
  const root = parseMillerstownRoot(await millerstownHtmlFixture("root"));
  const inventory = parseMillerstownInventory(
    await millerstownHtmlFixture("inventory"),
  );
  expect(inventory.pdfUrl).toBe(MILLERSTOWN_FIXTURE_PDF_URL);
  expect(inventory.proof).toEqual({ ...root, title: "Vehicles on Premises" });
});
for (const [name, change] of [
  [
    "owner",
    (html: string) => html.replaceAll("Millerstown Pic-A-Part Yard", "D & D"),
  ],
  [
    "address",
    (html: string) => html.replaceAll("3148 Lardintown Road", "Other Road"),
  ],
  ["phone", (html: string) => html.replaceAll("724-224-4777", "724-000-0000")],
  [
    "title",
    (html: string) =>
      html.replace("<title>Vehicles on Premises", "<title>Filtered Inventory"),
  ],
  [
    "heading",
    (html: string) =>
      html.replace(">Vehicles on Premises</h1>", ">Recent Vehicles</h1>"),
  ],
  [
    "canonical filter",
    (html: string) =>
      html.replace(
        'href="http://picapartyard.com/vehicles-on-premises/" rel="canonical"',
        'href="http://picapartyard.com/vehicles-on-premises/?make=Ford" rel="canonical"',
      ),
  ],
  [
    "viewer mismatch",
    (html: string) => html.replace("viewer?url=http", "viewer?url=xhttp"),
  ],
  [
    "duplicate link",
    (html: string) =>
      html.replace(
        "</body>",
        `<a href="${MILLERSTOWN_FIXTURE_PDF_URL}">Duplicate</a></body>`,
      ),
  ],
  [
    "duplicate owner",
    (html: string) =>
      html.replace(
        "</body>",
        '<div id="site_title">Millerstown Pic-A-Part Yard</div></body>',
      ),
  ],
  ["truncated page", (html: string) => html.replace("</html>", "")],
] as const)
  test(`native inventory rejects ${name}`, async () => {
    const original = await millerstownHtmlFixture("inventory");
    const changed = change(original);
    expect(changed).not.toBe(original);
    expect(() => parseMillerstownInventory(changed)).toThrow();
  });
test("scripts and comments cannot supply missing self-service scope", async () => {
  const root = (await millerstownHtmlFixture("root")).replace(
    "We are a self-service salvage yard",
    "We sell parts",
  );
  expect(() =>
    parseMillerstownRoot(
      root.replace(
        "</body>",
        "<!-- We are a self-service salvage yard --><script>We are a self-service salvage yard</script></body>",
      ),
    ),
  ).toThrow("self-service");
});
for (const url of [
  "https://foreign.example/wp-content/uploads/catalog.pdf",
  "http://user:password@picapartyard.com/wp-content/uploads/catalog.pdf",
  MILLERSTOWN_FIXTURE_PDF_URL + "?make=Ford",
  MILLERSTOWN_FIXTURE_PDF_URL + "#page=1",
  "http://picapartyard.com/inventory.pdf",
])
  test(`published PDF rejects unsupported destination ${url}`, () => {
    expect(() => millerstownPdfUrl(url)).toThrow("native upload");
  });
test("irrelevant markup leaves normalized ownership and inventory proof unchanged", async () => {
  const inventory = await millerstownHtmlFixture("inventory");
  expect(
    parseMillerstownInventory(
      inventory.replace("</body>", "<p>Updated footer decoration</p></body>"),
    ),
  ).toEqual(parseMillerstownInventory(inventory));
});
