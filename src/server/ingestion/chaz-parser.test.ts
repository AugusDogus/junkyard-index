import { expect, test } from "bun:test";
import {
  type ChazRecord,
  parseChazContact,
  parseChazDirectory,
  parseChazModel,
  parseChazRoot,
} from "./chaz-parser";
import {
  chazFixtureCard,
  chazFixtureContact,
  chazFixtureDirectory,
  chazFixtureMake,
  chazFixtureModel,
  chazFixtureModelPage,
  chazFixtureRecord,
  chazFixtureRoot,
} from "./chaz-test-fixtures";

test("Chaz preserves literal directory punctuation, labelled YMM and primary image metadata", () => {
  const model = {
    ...chazFixtureModel,
    path: "/parts/ACURA/MODEL~_1.0/",
    label: "ACURA MODEL 1.0",
    count: 1,
  };
  expect(
    parseChazDirectory(
      chazFixtureDirectory([model], "models"),
      "models",
      chazFixtureMake,
    ),
  ).toEqual([model]);
  const record = chazFixtureRecord(1);
  record[4] = "/parts/ACURA/MODEL~_1.0/ST1/2003";
  record[5] = "ST1/ST1_123.jpg";
  record[6] = "2026-10-22";
  const raw = chazFixtureModelPage([record]).replace(
    '</div><div class="card-body">',
    '<div style="display:none"><img data-src="https://example.com/other.jpg"></div></div><div class="card-body">',
  );
  expect(parseChazModel(raw, chazFixtureMake, model).records).toEqual([record]);
  expect(parseChazRoot(chazFixtureRoot([record])).records).toEqual([record]);
  expect(parseChazContact(chazFixtureContact)).toHaveLength(64);
});

test("Chaz accepts explicit empty results and retains every malformed VIN row above diagnostic badges", () => {
  expect(
    parseChazModel(chazFixtureModelPage([]), chazFixtureMake, chazFixtureModel)
      .records,
  ).toEqual([]);
  const invalid = chazFixtureRecord(1);
  invalid[0] = "-";
  invalid[5] = "https://example.com/placeholder.jpg";
  const parsed = parseChazModel(
    chazFixtureModelPage([invalid, chazFixtureRecord(2)]),
    chazFixtureMake,
    { ...chazFixtureModel, count: 1 },
  );
  const expected: ChazRecord = [...invalid];
  expected[5] = null;
  expect(parsed.records).toEqual([expected, chazFixtureRecord(2)]);
});

test("Chaz rejects missing donor regions, wrong model bodies, continuation and foreign suppliers", () => {
  const record = chazFixtureRecord(1);
  const raw = chazFixtureModelPage([record]);
  expect(() =>
    parseChazModel(
      raw.replace(chazFixtureCard(record), ""),
      chazFixtureMake,
      chazFixtureModel,
    ),
  ).toThrow("without an explicit empty");
  expect(() =>
    parseChazModel(
      raw.replaceAll("/ILX/", "/RDX/"),
      chazFixtureMake,
      chazFixtureModel,
    ),
  ).toThrow("another published model");
  expect(() =>
    parseChazModel(
      chazFixtureModelPage([], "Used ACURA RDX"),
      chazFixtureMake,
      chazFixtureModel,
    ),
  ).toThrow("another published model");
  expect(() =>
    parseChazModel(
      raw.replace(
        "</body>",
        '<a class="page-link" href="?page=2">Next</a></body>',
      ),
      chazFixtureMake,
      chazFixtureModel,
    ),
  ).toThrow("continuation");
  expect(() =>
    parseChazRoot(chazFixtureRoot([record]).replace("MD08", "AZ30")),
  ).toThrow("supplier MD08");
  expect(
    parseChazRoot(
      chazFixtureRoot([record]).replace(
        "</body>",
        "<script>var urgid = 'MD08';</script></body>",
      ),
    ).records,
  ).toEqual([record]);
  expect(() =>
    parseChazRoot(
      chazFixtureRoot([record]).replace(
        "</body>",
        "<script>var urgid = 'AZ30';</script></body>",
      ),
    ),
  ).toThrow("supplier MD08");
  expect(() =>
    parseChazContact(
      chazFixtureContact.replace("Taneytown, MD 21787", "Wrong City, MD 21787"),
    ),
  ).toThrow("physical address");
  expect(() => parseChazRoot(raw.slice(0, -80))).toThrow();
});

test("Chaz accepts repeated-brand inquiry display variants and aborts real required contradictions", () => {
  const raw = chazFixtureRoot([chazFixtureRecord(1)]);
  expect(
    parseChazRoot(
      raw.replace(
        'data-vehicle="2003 ACURA ILX',
        'data-vehicle="2003 ACURA ACURA ILX',
      ),
    ).records,
  ).toHaveLength(1);
  expect(() =>
    parseChazRoot(
      raw.replace(
        'data-vehicle="2003 ACURA ILX',
        'data-vehicle="2003 ACURA RDX',
      ),
    ),
  ).toThrow("inquiry");
  expect(() =>
    parseChazRoot(raw.replace('data-vehicle="2003', 'data-vehicle="2004')),
  ).toThrow("inquiry");
  expect(() =>
    parseChazRoot(
      raw.replace(
        " - VIN " + chazFixtureRecord(1)[0],
        " - VIN " + chazFixtureRecord(2)[0],
      ),
    ),
  ).toThrow("inquiry");
  const model = chazFixtureModelPage([chazFixtureRecord(1)]);
  expect(() =>
    parseChazModel(
      model.replace(
        "<b>Make/Model :</b> ACURA ILX",
        "<b>Make/Model :</b> ACURA RDX",
      ),
      chazFixtureMake,
      chazFixtureModel,
    ),
  ).toThrow("inquiry");
  expect(() =>
    parseChazRoot(
      model.replace("</body>", "<nav>Recent Arrivals</nav></body>"),
    ),
  ).toThrow("recent-arrival surface");
});
