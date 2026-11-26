import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  vehiclePhoto,
  hollanderVehiclePhoto,
  midwayVehiclePhoto,
  tritownVehiclePhoto,
  alsautoVehiclePhoto,
  httpsVehiclePhoto,
} from "./vehicle-photo";
import { parseHollanderstoresPage } from "./hollanderstores-parser";
import { hollanderstoresFixture } from "./hollanderstores-test-fixtures";
import { HOLLANDERSTORES_YARDS } from "./hollanderstores-yard-metadata";
import { hollanderstoresSnapshot } from "./hollanderstores-snapshot";
import { hollanderstoresSeed } from "./hollanderstores-client";
import { parseMidwayCatalog } from "./midway-parser";
import { transformMidwayRecord } from "./midway-transform";
import { parseBeaversCatalog, parseBeaversDetail } from "./beavers-parser";
import { beaversFixture } from "./beavers-test-fixtures";
import { BEAVERS_CATALOG } from "./beavers-yard-metadata";
import { beaversSnapshot } from "./beavers-transform";
import { parseTritownPage } from "./tritown-parser";
import { transformTritownRecord } from "./tritown-transform";
import { parseAlsautoPage } from "./alsauto-parser";
import { alsautoEvidence } from "./alsauto-test-fixtures";
import { alsautoSnapshot } from "./alsauto-snapshot";

const hollanderImage =
  "https://d1vnbry5hm94g5.cloudfront.net/AAE/EXY/7VQ/SSX/C-T.jpg";
test("AA Auto Salvage's reported Volvo photo survives roster parsing and canonical mapping", () => {
  const index = HOLLANDERSTORES_YARDS.findIndex(
    (y) => y.code === "aaautosalvage",
  );
  const page = parseHollanderstoresPage(
    hollanderstoresFixture("aaautosalvage"),
    index,
  );
  const row = page.rows.find((row) => row.vin === "YV1LS56D6X2572228");
  expect(row?.stock).toBe("240419");
  expect(row?.imageUrl).toBe(hollanderImage);
  // The saved make decodes let the yard pass its own guards and publish.
  const snapshot = hollanderstoresSnapshot([page], hollanderstoresSeed);
  expect(snapshot.rejectedYards).toEqual([]);
  expect(snapshot.vehicles.find((v) => v.vin === row?.vin)?.imageUrl).toBe(
    hollanderImage,
  );
});

test.each([
  hollanderImage.replace("https:", "http:"),
  hollanderImage.replace("cloudfront.net", "cloudfront.net.evil.test"),
  hollanderImage.replace("C-T.jpg", "no-image.jpg"),
  hollanderImage + "?redirect=elsewhere",
  "https://user:pass@d1vnbry5hm94g5.cloudfront.net/AA/E/EX/Y/C.jpg",
  "https://d1vnbry5hm94g5.cloudfront.net/Images/noimage.png",
  "javascript:alert(1)",
])("rejects unverified or placeholder Hollander photos (%#)", (value) => {
  expect(hollanderVehiclePhoto(value)).toBeNull();
});

test("Beaver's donor response already fetched for make includes its own vehicle photo", () => {
  const page = parseBeaversCatalog(beaversFixture("first"), BEAVERS_CATALOG);
  const row = page.rows[0];
  if (!row) throw new Error("Missing saved Beaver's row");
  const record = parseBeaversDetail(beaversFixture("donor"), row);
  expect(record.imageUrl).toBe(
    "https://d1vnbry5hm94g5.cloudfront.net/MB/6E/XU/UU/6.jpg",
  );
  expect(beaversSnapshot([record], null, 1).vehicles[0]?.imageUrl).toBe(
    record.imageUrl,
  );
});

test("Midway's saved inline catalog preserves vehicle photos without using logos", () => {
  const raw = gunzipSync(
    readFileSync(
      new URL("./midway-test-fixtures/tulsa-opening.html.gz", import.meta.url),
    ),
  ).toString();
  const records = parseMidwayCatalog(raw, "OO95", undefined, true);
  const record = records.find((record) => record.imageUrl);
  if (!record) throw new Error("Saved Midway catalog should contain a photo");
  const result = transformMidwayRecord(record, "OO95");
  expect(result.status).toBe("available");
  if (result.status === "available")
    expect(result.vehicle.imageUrl).toBe(record.imageUrl ?? null);
  expect(
    vehiclePhoto(
      "https://midwayupull.com/logo.png",
      "da8h1v3w8q6n5.cloudfront.net",
      /./,
    ),
  ).toBeNull();
});

test("Midway Muncie uses its published mo06 photo prefix rather than its physical yard code", () => {
  const raw = gunzipSync(
    readFileSync(
      new URL("./midway-test-fixtures/muncie-photos.html.gz", import.meta.url),
    ),
  ).toString();
  const records = parseMidwayCatalog(raw, "MO38", undefined, true);
  const record = records.find((r) => r.stock === "2604699");
  if (!record) throw new Error("Missing captured Muncie stock");
  const result = transformMidwayRecord(record, "MO38");
  expect(result.status).toBe("available");
  if (result.status === "available") {
    expect(result.vehicle.imageUrl).toBe(
      "https://da8h1v3w8q6n5.cloudfront.net/mo06/images/2604699/2604699_0.jpg",
    );
    expect(result.vehicle.locationCode).toBe("MO38");
  }
});

test("TriTown's fetched AJAX listing carries the donor thumbnail without a detail request", () => {
  const raw = readFileSync(
    new URL("./tritown-test-fixtures/photo-listings.json", import.meta.url),
    "utf8",
  );
  const page = parseTritownPage(raw, 1);
  const record = page.records[0];
  if (!record) throw new Error("Missing native TriTown donor");
  const result = transformTritownRecord(record, [
    "Jeep",
    "Ford",
    "Porsche",
    "Chevrolet",
  ]);
  expect(result.status).toBe("available");
  if (result.status === "available")
    expect(result.vehicle.imageUrl).toBe(
      "https://tritownautosalvage.com/wp-content/uploads/2026/10/IMG_6124-100x100.jpeg",
    );
  const replaced = JSON.stringify(JSON.parse(raw), null, 2).replaceAll(
    "https://tritownautosalvage.com/wp-content/uploads/",
    "http://unowned.test/wp-content/uploads/",
  );
  expect(
    parseTritownPage(replaced, 1).records.every((r) => r.imageUrl === null),
  ).toBe(true);
});

test("Al's fetched inventory card maps its published acquisition photo to its VIN", () => {
  const raw = alsautoEvidence[1];
  if (!raw) throw new Error("Missing native Al's page");
  const page = parseAlsautoPage(raw, 1);
  const record = page.records.find((r) => r.vin === "2GNALBEK7C1143724");
  if (!record) throw new Error("Missing saved Al's donor");
  expect(record.imageUrl).toBe(
    "https://cs.copart.com/v1/AUTH_svc.pdoc00001/lpp/0926/85f394d1eb4f47468f6043bbfd7444ae_thb.jpg",
  );
  expect(
    alsautoSnapshot([record], null, new Date("2026-11-17")).vehicles[0]
      ?.imageUrl,
  ).toBe(record.imageUrl);
});

test("new photo mappings reject placeholders and unowned hosts without rejecting donors", () => {
  for (const [validate, url] of [
    [
      midwayVehiclePhoto,
      "https://da8h1v3w8q6n5.cloudfront.net/mo06/images/2604699/2604699_0.jpg",
    ],
    [
      tritownVehiclePhoto,
      "https://tritownautosalvage.com/wp-content/uploads/2026/10/IMG_6124-100x100.jpeg",
    ],
    [
      alsautoVehiclePhoto,
      "https://cs.copart.com/v1/AUTH_svc.pdoc00001/lpp/0926/85f394d1eb4f47468f6043bbfd7444ae_thb.jpg",
    ],
  ] satisfies ReadonlyArray<
    readonly [(raw: unknown) => string | null, string]
  >) {
    expect(validate(url)).toBe(url);
    expect(validate(url.replace("https:", "http:"))).toBeNull();
    expect(validate(url.replace(new URL(url).host, "unowned.test"))).toBeNull();
    expect(validate(url.replace(/[^/]+$/, "no-image.jpg"))).toBeNull();
  }
});

test("any-host photos must still name an image file", () => {
  const photo =
    "https://9868ca324016b659551139193b5094e3.cdn.bubble.io/f1740076241249x266681885758848900/IMG_7338.jpeg";
  expect(httpsVehiclePhoto(photo)).toBe(photo);
  // A live Ario photo: Bubble serves uploads without a file extension.
  const bare =
    "https://9868ca324016b659551139193b5094e3.cdn.bubble.io/f1736184576090x468952839371479940/250106050135-qzNn";
  expect(httpsVehiclePhoto(bare)).toBe(bare);
  for (const raw of [
    "https://cdn.example.com",
    "https://cdn.example.com/",
    "https://cdn.example.com/photo.gif",
    "https://cdn.example.com/photo.jpg/",
    "https://cdn.example.com/listing.html",
  ])
    expect(httpsVehiclePhoto(raw)).toBeNull();
});
