import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseUpullitwaPage, upullitwaPageUrl } from "./upullitwa-client";
import { transformUpullitwaVehicle } from "./upullitwa-transform";
import { upullitwaYard } from "./upullitwa-yard-metadata";

const fixture = readFileSync(
  new URL("./fixtures/upullitwa-page.html", import.meta.url),
  "utf8",
);

function vehicleWithImage(imageHtml: string) {
  const html = fixture.replace(
    /<th scope="row">[\s\S]*?<\/th>/,
    `<th scope="row">${imageHtml}</th>`,
  );
  const record = parseUpullitwaPage(html, "JJ65", 1).records[0];
  const yard = upullitwaYard("JJ65");
  if (!record || !yard) throw new Error("Missing test record or yard");
  return transformUpullitwaVehicle(record, yard);
}

// Public table samples observed 2026-09-16. All three yards actually use the
// jj65 CDN directory; do not derive image paths from the selected yard ID.
test.each([
  [
    "JJ65",
    "JTKDE177660105381",
    "2L2241",
    "2L2241_1.jpg",
    "2006",
    "SCION",
    "SCION TC",
  ],
  [
    "UU43",
    "3GYFNBE31FS602685",
    "1N1497",
    "1N1497_10.jpg",
    "2015",
    "CADILLAC",
    "SRX",
  ],
  [
    "UU44",
    "JM1BK343481838384",
    "3B0716",
    "3B0716_10.jpg",
    "2008",
    "MAZDA",
    "MAZDA 3",
  ],
])(
  "preserves %s's published photo and links to its VIN-filtered inventory",
  (id, vin, stock, filename, year, make, model) => {
    const imageUrl = `https://da8h1v3w8q6n5.cloudfront.net/jj65/images/${stock}/${filename}`;
    const html = fixture
      .replace(" selected", "")
      .replace(`value="${id}"`, `value="${id}" selected`)
      .replaceAll("id=JJ65", `id=${id}`)
      .replace("1G1PC5SB9F7289888", vin)
      .replace("2L2258", stock)
      .replace("2015", year)
      .replace("CHEVROLET", make)
      .replace("CRUZE", model)
      .replaceAll(
        "https://via.placeholder.com/348x251?text=No+Image+Available",
        imageUrl,
      );
    const record = parseUpullitwaPage(html, id, 1).records[0];
    const yard = upullitwaYard(id);
    if (!record || !yard) throw new Error("Missing test record or yard");
    const vehicle = transformUpullitwaVehicle(record, yard);
    expect(vehicle).toMatchObject({
      vin,
      stockNumber: stock,
      imageUrl,
      detailsUrl: `https://go2upullit.com/inventory/ANY/ANY/?k=1&id=${id}&view=table&search=${vin}`,
    });
  },
);

test.each([
  [
    "/photos/car.jpg?size=large&amp;id=12",
    "https://go2upullit.com/photos/car.jpg?size=large&id=12",
  ],
  ["photos/car.jpg", "https://go2upullit.com/inventory/ANY/ANY/photos/car.jpg"],
  ["//cdn.example.com/car.jpg", "https://cdn.example.com/car.jpg"],
  [
    "https://cdn.example.com/car.jpg?x=1&#038;y=2",
    "https://cdn.example.com/car.jpg?x=1&y=2",
  ],
])("resolves and decodes published image src %s", (src, expected) => {
  expect(vehicleWithImage(`<img src="${src}">`)?.imageUrl).toBe(expected);
});

test.each([
  "",
  "   ",
  "javascript:alert(1)",
  "data:image/png;base64,AAAA",
  "https://user:password@cdn.example.com/car.jpg",
  "https://via.placeholder.com/348x251?text=No+Image+Available",
  "/images/no-image.jpg",
  "https://cdn.example.com/348x251?text=No%20Image%20Available",
])("omits unusable image src %s without rejecting the vehicle", (src) => {
  expect(vehicleWithImage(`<img src="${src}">`)).toMatchObject({
    vin: "1G1PC5SB9F7289888",
    imageUrl: null,
  });
});

test("does not mistake CSS placeholders, galleries or data-src attributes for a published image src", () => {
  for (const image of [
    '<div class="no-image" style="background-image:url(/images/car-silhouette.png)"></div>',
    '<img data-src="/photos/car.jpg">',
    '<a href="/photos/car.jpg"><i class="no-image"></i></a>',
  ]) {
    expect(vehicleWithImage(image)?.imageUrl).toBeNull();
  }
});

test("media changes preserve the native crawl page and fingerprint", () => {
  const before = parseUpullitwaPage(fixture, "JJ65", 1);
  const after = parseUpullitwaPage(
    fixture.replaceAll(
      "https://via.placeholder.com/348x251?text=No+Image+Available",
      "/photos/car.jpg",
    ),
    "JJ65",
    1,
  );
  expect(after.fingerprint).toBe(before.fingerprint);
  expect(after.nextUrl).toBe(upullitwaPageUrl("JJ65", 2));
  expect(after.lastPage).toBe(before.lastPage);
  expect(after.records).toHaveLength(before.records.length);
});
