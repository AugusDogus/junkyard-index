import { expect, test } from "bun:test";
import {
  parseRustyhookCatalog,
  parseRustyhookDetail,
} from "./rustyhook-parser";
import {
  rustyhookTestCatalog,
  rustyhookTestDetail,
  rustyhookTestPosts,
} from "./rustyhook-test-fixtures";
import { RUSTYHOOK_CATALOG } from "./rustyhook-yard-metadata";

test("Rusty Hook counts literal donors including ID0 and retains published page aliases", () => {
  const root = parseRustyhookCatalog(rustyhookTestCatalog(), RUSTYHOOK_CATALOG);
  expect(root.posts).toHaveLength(12);
  expect(root.links).toEqual([
    { page: 2, url: "http://salvage.rustyhooktowing.com/index.php?SPage=1" },
    { page: 3, url: "http://salvage.rustyhooktowing.com/index.php?SPage=2" },
  ]);
  const last = parseRustyhookCatalog(
    rustyhookTestCatalog(3),
    root.links[1]?.url ?? "",
  );
  expect(last.posts.at(-1)?.url).toEndWith("ID=0");
  expect(last.links[0]).toEqual({
    page: 1,
    url: "http://salvage.rustyhooktowing.com/index.php?SPage=0",
  });
});

test("Rusty Hook preserves literal native fields, notes and donor-bound direct images", () => {
  const post = rustyhookTestPosts[25];
  if (!post) throw new Error("Missing ID0 fixture");
  const record = parseRustyhookDetail(rustyhookTestDetail(25), post);
  expect(record.fields).toMatchObject({
    VIN: "XXXX00000E1031782",
    Year: "1958",
    "Exterior Color": "NA",
  });
  expect(record.images).toEqual([
    "http://salvage.rustyhooktowing.com/Salvage/XXXX00000E1031782/Images/first.jpg",
  ]);
});

test("Rusty Hook listing photos remain optional without dropping native donors", () => {
  const html = rustyhookTestCatalog().replace(
    /<a\b[^>]*><img\b[^>]*><\/a>/g,
    "",
  );
  expect(parseRustyhookCatalog(html, RUSTYHOOK_CATALOG).posts).toHaveLength(12);
});

test.each([
  rustyhookTestCatalog().replace("</html>", ""),
  rustyhookTestCatalog().replace("3015 Mt. Troy Rd.", "727 Perry Hwy"),
  rustyhookTestCatalog().replaceAll("SPage=1", "SPage=4"),
  rustyhookTestCatalog().replace("ID=25", "ID=025"),
  rustyhookTestCatalog().replace(
    "http://salvage.rustyhooktowing.com/index.php?E=Detail",
    "http://harmony.rustyhookautosalvage.com/index.php?E=Detail",
  ),
])(
  "Rusty Hook rejects incomplete or conflicting native catalog structure (%#)",
  (html) => {
    expect(() => parseRustyhookCatalog(html, RUSTYHOOK_CATALOG)).toThrow();
  },
);
