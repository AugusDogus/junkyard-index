import { expect, test } from "bun:test";
import { transformCentralRecord } from "./central-transform";
import { CENTRAL_IMAGE_PREFIX } from "./central-yard-metadata";
import {
  parseCentralDirectory,
  parseCentralModel,
  parseCentralRoot,
} from "./central-parser";
import {
  centralFixtureDirectory,
  centralFixtureCard,
  centralFixtureDocument,
  centralFixtureMake,
  centralFixtureModel,
  centralFixtureModelPage,
  centralFixtureRecord,
  centralFixtureRoot,
} from "./central-test-fixtures";

test("Central binds native DD15 controls, complete markup and source ownership", () => {
  expect(parseCentralRoot(centralFixtureRoot)).toHaveLength(64);
  expect(
    parseCentralDirectory(
      centralFixtureDirectory([centralFixtureMake], "makes"),
      "makes",
    ),
  ).toEqual([centralFixtureMake]);
  expect(() =>
    parseCentralRoot(centralFixtureRoot.replace("DD15", "QQ91")),
  ).toThrow("supplier");
  expect(() =>
    parseCentralRoot(centralFixtureRoot.replace("245 Davis Road", "other")),
  ).toThrow("address");
  expect(() =>
    parseCentralModel(
      centralFixtureModelPage([centralFixtureRecord(1)]).replace("</html>", ""),
      centralFixtureMake,
      centralFixtureModel,
    ),
  ).toThrow("truncated");
});
test("Central preserves native ampersands and distinct literal Town & Country routes", () => {
  const make = {
    ...centralFixtureMake,
    path: "/used-parts/CHRYSLER",
    label: "CHRYSLER",
  };
  const model = {
    ...centralFixtureModel,
    path: make.path + "/TOWN_-and_COUNTRY",
    label: "TOWN & COUNTRY",
  };
  const row = centralFixtureRecord(1);
  row[2] = "CHRYSLER TOWN & COUNTRY";
  row[4] = make.path + "/TOWN_and__COUNTRY/ST1/2003";
  const html = centralFixtureModelPage([row], make, model).replace(
    "Used CHRYSLER TOWN &amp; COUNTRY",
    "Used CHRYSLER TOWN -and COUNTRY",
  );
  expect(parseCentralModel(html, make, model).records).toEqual([row]);
  const amp = centralFixtureRecord(2);
  amp[3] = "J&V";
  amp[4] = "/used-parts/ACURA/ILX/J&V/2003";
  expect(
    parseCentralModel(
      centralFixtureModelPage([amp]).replaceAll("&amp;", "&#038;"),
      centralFixtureMake,
      centralFixtureModel,
    ).records,
  ).toEqual([amp]);
});
test("Central detects numeric pagination while classifying native photograph carousel controls", () => {
  const row = centralFixtureRecord(1);
  for (const control of [
    '<a href="?page=2">2</a>',
    '<a href="/used-parts/ACURA/ILX/page/2/">2</a>',
    '<nav class="pagination"><a href="?p=2">2</a></nav>',
    '<button data-cursor="abc">2</button>',
    '<a href="/used-parts/ACURA/ILX?batch=2">2</a>',
  ])
    expect(() =>
      parseCentralModel(
        centralFixtureModelPage([row]).replace("</body>", control + "</body>"),
        centralFixtureMake,
        centralFixtureModel,
      ),
    ).toThrow(/continuation|pagination/);
  const carousel =
    '<button class="aps-gallery-carousel-control" data-bs-target="#apsPartsGalleryCarousel"><span>Next</span></button>';
  expect(
    parseCentralModel(
      centralFixtureModelPage([row]).replace("</body>", carousel + "</body>"),
      centralFixtureMake,
      centralFixtureModel,
    ).records,
  ).toHaveLength(1);
  expect(() =>
    parseCentralModel(
      centralFixtureModelPage([row]).replace(
        "</body>",
        carousel.replace("#apsPartsGalleryCarousel", "#inventory") + "</body>",
      ),
      centralFixtureMake,
      centralFixtureModel,
    ),
  ).toThrow("continuation");
});
test("Central does not skip unclassified empty cards, foreign destinations or new homepage donor surfaces", () => {
  const row = centralFixtureRecord(1);
  row[4] = "https://example.com/used-parts/ACURA/ILX/ST1/2003";
  expect(() =>
    parseCentralModel(
      centralFixtureModelPage([row]),
      centralFixtureMake,
      centralFixtureModel,
    ),
  ).toThrow("foreign");
  expect(() =>
    parseCentralModel(
      centralFixtureModelPage([]),
      centralFixtureMake,
      centralFixtureModel,
    ),
  ).toThrow("wrappers");
  expect(() =>
    parseCentralRoot(
      centralFixtureDocument('<a href="/latest-arrivals/">Latest Arrivals</a>'),
    ),
  ).toThrow("unclassified");
});

test("Central does not omit donor cards added to directories or legacy cards mixed into premium inventory", () => {
  const row = centralFixtureRecord(1);
  expect(() =>
    parseCentralDirectory(
      centralFixtureDirectory([centralFixtureMake], "makes").replace(
        "</body>",
        centralFixtureCard(row) + "</body>",
      ),
      "makes",
    ),
  ).toThrow("unclassified donor");
  expect(() =>
    parseCentralModel(
      centralFixtureModelPage([row]).replace(
        "</body>",
        '<div class="card-price">New native donor</div></body>',
      ),
      centralFixtureMake,
      centralFixtureModel,
    ),
  ).toThrow("legacy donor");
});

test("Central makes oversized or ambiguous optional card fields null without rejecting native identity", () => {
  const stock = centralFixtureRecord(1);
  stock[3] = "S".repeat(101);
  const image = centralFixtureRecord(2);
  image[5] = "ST2/" + "S".repeat(1500) + ".jpg";
  const primary = centralFixtureRecord(3);
  primary[5] = "ST3/ST3_1.jpg";
  const documents = [
    centralFixtureModelPage([stock]),
    centralFixtureModelPage([image]),
    centralFixtureModelPage([primary]).replace(
      'src="' + CENTRAL_IMAGE_PREFIX + 'ST3/ST3_1.jpg"',
      'src="' +
        CENTRAL_IMAGE_PREFIX +
        'ST3/ST3_1.jpg" src="' +
        CENTRAL_IMAGE_PREFIX +
        'ST3/ST3_2.jpg"',
    ),
  ];
  documents.forEach((document, index) => {
    const record = parseCentralModel(
      document,
      centralFixtureMake,
      centralFixtureModel,
    ).records[0];
    expect(record).toBeDefined();
    if (!record) throw new Error("Native test card disappeared");
    const result = transformCentralRecord(record, {
      make: "ACURA",
      model: "ILX",
      makePath: centralFixtureMake.path,
    });
    expect(result.status).toBe("available");
    if (result.status === "available")
      expect(result.vehicle).toMatchObject({
        stockNumber: index === 0 ? null : "ST" + (index + 1),
        imageUrl: null,
      });
  });
});
