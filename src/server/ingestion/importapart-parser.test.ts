import { expect, test } from "bun:test";
import {
  parseImportapartCatalog,
  parseImportapartDetail,
} from "./importapart-parser";
import {
  importapartTestDetail,
  importapartTestListing,
  importapartTestPost,
} from "./importapart-test-fixtures";

test("Importapart enumerates source-published contiguous pages", () => {
  const posts = Array.from({ length: 12 }, (_, index) => ({
    ...importapartTestPost,
    url: importapartTestPost.url + "-" + index,
  }));
  expect(
    parseImportapartCatalog(importapartTestListing(1, posts, 7), 1),
  ).toEqual({ page: 1, lastPage: 7, posts });
  expect(
    parseImportapartCatalog(
      importapartTestListing(7, [importapartTestPost], 7),
      7,
    ).lastPage,
  ).toBe(7);
});
test("Importapart reads donor identity only from its first content paragraph", () => {
  const record = parseImportapartDetail(
    importapartTestDetail({ vinLabel: false }),
    importapartTestPost,
  );
  expect(record).toMatchObject({
    post: importapartTestPost,
    header: "2001 Mazda Miata - PART OUT",
    vin: "JM1NB353710207894",
    stock: "10207894",
  });
});

test("Importapart unverified optional scalar text never blocks the native VIN", () => {
  const html = importapartTestDetail({ stock: "&minus;" }).replace(
    "Exterior Color: Red",
    "Unknown optional color: &bogus;",
  );
  expect(parseImportapartDetail(html, importapartTestPost)).toMatchObject({
    vin: "JM1NB353710207894",
    stock: "",
  });
});

test("Importapart accepts a title-only paragraph followed immediately by a VIN header", () => {
  const html = importapartTestDetail().replace(
    "</strong><br><strong>VIN:",
    "</strong></p><p><strong>VIN:",
  );
  expect(parseImportapartDetail(html, importapartTestPost)).toMatchObject({
    vin: "JM1NB353710207894",
    stock: "10207894",
  });
});

test.each(["12/34", "AB.123", "A".repeat(101)])(
  "Importapart invalid optional stocks are null without prefix inference (%s)",
  (stock) => {
    expect(
      parseImportapartDetail(
        importapartTestDetail({ stock }),
        importapartTestPost,
      ),
    ).toMatchObject({ vin: "JM1NB353710207894", stock: "" });
  },
);
test.each([
  importapartTestListing().replace("</html>", ""),
  importapartTestListing().replace("CURRENT INVENTORY", "Past Inventory"),
  importapartTestListing().replace("7373 Hazelwood Ave", "123 Another Yard"),
  importapartTestListing().replace(
    'class="partouts-test__card"',
    'class="changed-card"',
  ),
  importapartTestListing(1, [importapartTestPost], 7).replace(
    'href="/blogs/part-outs?page=2"',
    'href="/blogs/part-outs?page=3"',
  ),
  importapartTestListing().replace(
    importapartTestPost.url,
    "https://example.com/blogs/part-outs/donor",
  ),
  importapartTestListing().replace("</a>", ""),
  importapartTestListing(1, [importapartTestPost], 7),
])("Importapart rejects changed or partial catalog scope (%#)", (html) => {
  expect(() => parseImportapartCatalog(html, 1)).toThrow();
});
test.each([
  importapartTestDetail().replace("</rte-formatter>", ""),
  importapartTestDetail().replace(
    "We are located at 7373 Hazelwood Ave.",
    "We are located at 123 Another Yard.",
  ),
  importapartTestDetail().replace("<h1>2001", "<h1>2002"),
])("Importapart rejects incomplete or unowned detail (%#)", (html) => {
  expect(() => parseImportapartDetail(html, importapartTestPost)).toThrow();
});
