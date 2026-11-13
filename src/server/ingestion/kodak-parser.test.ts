import { expect, test } from "bun:test";
import { parseKodakInventory, parseKodakOwnership } from "./kodak-parser";
import {
  kodakTestCard,
  kodakTestInventory,
  kodakTestRoot,
} from "./kodak-test-fixtures";

test("parses native card identity independently of decorative make sections", () => {
  const records = parseKodakInventory(
    kodakTestInventory(kodakTestCard(0, "2012 MINI COOPER Countryman S")),
  );
  expect(records[0]?.title).toBe("2012 MINI COOPER Countryman S");
  expect(records[0]?.fields.VIN).toBe("2B3KA43D29H614022");
  expect(parseKodakOwnership(kodakTestRoot).inventoryUrl).toBe(
    "https://kodakauto.co/pull-a-part",
  );
});

test("absent optional image and price do not erase a donor", () => {
  const card = kodakTestCard()
    .replace(/<img\b[^>]*>/, "")
    .replace(/<div data-aid="MENU_SECTION0_ITEM0_PRICE">.*?<\/div>/, "");
  expect(parseKodakInventory(kodakTestInventory(card))[0]).toMatchObject({
    photo: null,
    printedIdentifier: null,
  });
});

test("retains missing required title or VIN for quality rejection", () => {
  const card = kodakTestCard()
    .replace(/<h4\b[^>]*>.*?<\/h4>/, "")
    .replace(/VIN: [^<]+/, "VIN: ");
  expect(parseKodakInventory(kodakTestInventory(card))[0]).toMatchObject({
    title: "",
    fields: { VIN: "" },
  });
});

test.each([
  {
    change: (card: string) => card.replace("Color: Gray", "Color: &#0;"),
    field: "Color",
  },
  {
    change: (card: string) => card.replace("Color: Gray", "Color: R&eacute;d"),
    field: "Color",
  },
  {
    change: (card: string) =>
      card.replace("Color: Gray", "Color: Gray</p><p>Color: Black"),
    field: "Color",
  },
  {
    change: (card: string) => card.replace("Engine: 2.7L", "Engine: &#0;"),
    field: "Engine",
  },
  {
    change: (card: string) => card.replace("#250041", "&#0;"),
    field: "printedIdentifier",
  },
])(
  "unusable or conflicting optional text does not reject native donors",
  ({ change, field }) => {
    const record = parseKodakInventory(
      kodakTestInventory(change(kodakTestCard())),
    )[0];
    expect(record?.fields.VIN).toBe("2B3KA43D29H614022");
    expect(record?.title).toBe("2009 DODGE CHARGER SE");
    expect(
      field === "printedIdentifier"
        ? record?.printedIdentifier
        : (record?.fields[field] ?? null),
    ).toBeNull();
    expect(
      Object.values(record?.fields ?? {}).some(
        (value) => value.includes("&#") || value.includes("&eacute;"),
      ),
    ).toBe(false);
  },
);

test.each([
  (html: string) => html.replace("</html>", ""),
  (html: string) => html.replace("Inventory List", "Parts for sale"),
  (html: string) =>
    html.replace("</head>", '<link rel="next" href="?page=2"></head>'),
  (html: string) =>
    html.replace("</body>", '<a href="?page=2">Next</a></body>'),
  (html: string) =>
    html.replace("</body>", "<p>VIN: 2B3KA43D29H614022</p></body>"),
  (html: string) => html.replace("Engine: 2.7L", "VIN: 2B3KA43D29H614022"),
  (html: string) =>
    html.replace(
      "</body>",
      '<h4 data-aid="MENU_SECTION0_ITEM0_TITLE">2009 DODGE CHARGER</h4></body>',
    ),
  (html: string) =>
    html.replace(
      "</body>",
      '<a href="/recent-arrivals">Recent Arrivals</a></body>',
    ),
  (html: string) =>
    html.replace("kodakauto.co/pull-a-part", "foreign.example/pull-a-part"),
])(
  "rejects incomplete, foreign, ambiguous or expanded catalog grammar",
  (change) => {
    expect(() => parseKodakInventory(change(kodakTestInventory()))).toThrow();
  },
);

test("ownership cannot be replaced by a dealer-only or foreign root", () => {
  expect(() =>
    parseKodakOwnership(
      kodakTestRoot.replace(
        "parts stripped from our Salvage lot.",
        "Used cars for sale.",
      ),
    ),
  ).toThrow();
  expect(() =>
    parseKodakOwnership(
      kodakTestRoot.replace("647 Asheville Hwy", "Elsewhere"),
    ),
  ).toThrow();
});
