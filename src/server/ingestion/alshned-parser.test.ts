import { expect, test } from "bun:test";
import { alshnedFixture } from "./alshned-test-fixtures";
import {
  AlshnedCatalog,
  AlshnedDonor,
  alshnedListingPage,
  alshnedDonorHandle,
  ALSHNED_CATALOG,
} from "./alshned-parser";

test("actual Alshned 24/19 page traversal closes all 43 native donors", () => {
  const first = AlshnedCatalog.parse(
    alshnedFixture("opening-collection"),
    ALSHNED_CATALOG,
  );
  const second = AlshnedCatalog.parse(
    alshnedFixture("opening-page2"),
    first.next ?? "",
  );
  expect([first.total, first.cards.length, first.page, first.lastPage]).toEqual(
    [43, 24, 1, 2],
  );
  expect([second.cards.length, second.page, second.next]).toEqual([
    19,
    2,
    null,
  ]);
  expect(
    new Set([...first.cards, ...second.cards].map((c) => c.url)).size,
  ).toBe(43);
  expect(AlshnedCatalog.membership(first)).toEqual(
    AlshnedCatalog.membership(
      AlshnedCatalog.parse(
        alshnedFixture("closing-collection"),
        ALSHNED_CATALOG,
      ),
    ),
  );
});

test("actual primary publishes VIN, stock and source-bound optional image", () => {
  const first = AlshnedCatalog.parse(
    alshnedFixture("opening-collection"),
    ALSHNED_CATALOG,
  );
  const card = first.cards[0];
  if (!card) throw new Error("Missing actual first native donor");
  const donor = AlshnedDonor.parse(alshnedFixture("detail-01"), card);
  expect(donor).toMatchObject({
    title: card.title,
    heading: card.title,
    vin: "5N1AZ2MH8GN108848",
    brand: "Nissan",
    stock: "0D0044",
    active: true,
  });
  expect(donor.imageUrl).toContain("https://alshnedauto.com/cdn/shop/files/");
});

test("truncated, challenged, foreign and mismatched-page responses stop traversal", () => {
  const raw = alshnedFixture("opening-collection");
  for (const changed of [
    raw.replace("</html>", ""),
    raw.replace("1231 Hayes Blvd", "1232 Hayes Blvd"),
    raw.replace("43 products", "44 products"),
    raw.replace(
      'href="/products/donor-',
      'href="https://foreign.invalid/products/donor-',
    ),
  ]) {
    expect(() => AlshnedCatalog.parse(changed, ALSHNED_CATALOG)).toThrow();
  }
  expect(() =>
    AlshnedCatalog.parse(raw, ALSHNED_CATALOG + "?page=2"),
  ).toThrow();
});

test("native navigation accepts only exact finite same-host destinations", () => {
  expect(alshnedListingPage(ALSHNED_CATALOG)).toBe(1);
  expect(alshnedListingPage(ALSHNED_CATALOG + "?page=2")).toBe(2);
  for (const url of [
    ALSHNED_CATALOG + "?page=02",
    ALSHNED_CATALOG + "?page=2&x=1",
    ALSHNED_CATALOG + "#x",
    ALSHNED_CATALOG.replace("alshnedauto.com", "www.alshnedauto.com"),
  ])
    expect(alshnedListingPage(url)).toBeNull();
  expect(
    alshnedDonorHandle(
      "https://alshnedauto.com/products/donor-vehicle-2016-nissan-murano-platinum-brown",
    ),
  ).toBe("donor-vehicle-2016-nissan-murano-platinum-brown");
  expect(
    alshnedDonorHandle("https://alshnedauto.com/products/component"),
  ).toBeNull();
});
