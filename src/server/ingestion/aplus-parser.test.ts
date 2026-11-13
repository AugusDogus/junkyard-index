import { expect, test } from "bun:test";
import {
  type AplusRecord,
  parseAplusContact,
  parseAplusDirectory,
  parseAplusModel,
  parseAplusRoot,
} from "./aplus-parser";
import {
  aplusFixtureCard,
  aplusFixtureContact,
  aplusFixtureDirectory,
  aplusFixtureMake,
  aplusFixtureModel,
  aplusFixtureModelPage,
  aplusFixtureRecord,
  aplusFixtureRoot,
} from "./aplus-test-fixtures";

test("Aplus preserves literal directory punctuation, labelled YMM and primary image metadata", () => {
  const model = {
    ...aplusFixtureModel,
    path: "/parts/ACURA/MODEL~_1.0/",
    label: "ACURA MODEL 1.0",
    count: 1,
  };
  expect(
    parseAplusDirectory(
      aplusFixtureDirectory([model], "models"),
      "models",
      aplusFixtureMake,
    ),
  ).toEqual([model]);
  const record = aplusFixtureRecord(1);
  record[4] = "/parts/ACURA/MODEL~_1.0/ST1/2003";
  record[5] = "ST1/ST1_123.jpg";
  record[6] = "2026-10-22";
  const raw = aplusFixtureModelPage([record]).replace(
    '</div><div class="card-body">',
    '<div style="display:none"><img data-src="https://example.com/other.jpg"></div></div><div class="card-body">',
  );
  expect(parseAplusModel(raw, aplusFixtureMake, model).records).toEqual([
    record,
  ]);
  expect(parseAplusRoot(aplusFixtureRoot([record])).records).toEqual([record]);
  expect(parseAplusContact(aplusFixtureContact)).toHaveLength(64);
});

test("Aplus accepts explicit empty results and retains every malformed VIN row above diagnostic badges", () => {
  expect(
    parseAplusModel(
      aplusFixtureModelPage([]),
      aplusFixtureMake,
      aplusFixtureModel,
    ).records,
  ).toEqual([]);
  const invalid = aplusFixtureRecord(1);
  invalid[0] = "-";
  invalid[5] = "https://example.com/placeholder.jpg";
  const parsed = parseAplusModel(
    aplusFixtureModelPage([invalid, aplusFixtureRecord(2)]),
    aplusFixtureMake,
    { ...aplusFixtureModel, count: 1 },
  );
  const expected: AplusRecord = [...invalid];
  expected[5] = null;
  expect(parsed.records).toEqual([expected, aplusFixtureRecord(2)]);
});

test("Aplus rejects missing donor regions, wrong model bodies, continuation and foreign suppliers", () => {
  const record = aplusFixtureRecord(1);
  const raw = aplusFixtureModelPage([record]);
  expect(() =>
    parseAplusModel(
      raw.replace(aplusFixtureCard(record), ""),
      aplusFixtureMake,
      aplusFixtureModel,
    ),
  ).toThrow("without an explicit empty");
  expect(() =>
    parseAplusModel(
      raw.replaceAll("/ILX/", "/RDX/"),
      aplusFixtureMake,
      aplusFixtureModel,
    ),
  ).toThrow("another published model");
  expect(() =>
    parseAplusModel(
      aplusFixtureModelPage([], "Used ACURA RDX Parts"),
      aplusFixtureMake,
      aplusFixtureModel,
    ),
  ).toThrow("another published model");
  expect(() =>
    parseAplusModel(
      raw.replace(
        "</body>",
        '<a class="page-link" href="?page=2">Next</a></body>',
      ),
      aplusFixtureMake,
      aplusFixtureModel,
    ),
  ).toThrow("continuation");
  expect(() =>
    parseAplusRoot(aplusFixtureRoot([record]).replace("QQ91", "AZ30")),
  ).toThrow("supplier QQ91");
  expect(
    parseAplusRoot(
      aplusFixtureRoot([record]).replace(
        "</body>",
        "<script>var urgid = 'QQ91';</script></body>",
      ),
    ).records,
  ).toEqual([record]);
  expect(() =>
    parseAplusRoot(
      aplusFixtureRoot([record]).replace(
        "</body>",
        "<script>var urgid = 'AZ30';</script></body>",
      ),
    ),
  ).toThrow("supplier QQ91");
  expect(() =>
    parseAplusContact(
      aplusFixtureContact.replace(
        "Nicholasville, KY 40356",
        "Wrong City, KY 40356",
      ),
    ),
  ).toThrow("physical address");
  expect(() => parseAplusRoot(raw.slice(0, -80))).toThrow();
});

test("Aplus accepts repeated-brand inquiry display variants and aborts real required contradictions", () => {
  const raw = aplusFixtureRoot([aplusFixtureRecord(1)]);
  expect(
    parseAplusRoot(
      raw.replace(
        'data-vehicle="2003 ACURA ILX',
        'data-vehicle="2003 ACURA ACURA ILX',
      ),
    ).records,
  ).toHaveLength(1);
  expect(() =>
    parseAplusRoot(
      raw.replace(
        'data-vehicle="2003 ACURA ILX',
        'data-vehicle="2003 ACURA RDX',
      ),
    ),
  ).toThrow("inquiry");
  expect(() =>
    parseAplusRoot(raw.replace('data-vehicle="2003', 'data-vehicle="2004')),
  ).toThrow("inquiry");
  expect(() =>
    parseAplusRoot(
      raw.replace(
        " - VIN " + aplusFixtureRecord(1)[0],
        " - VIN " + aplusFixtureRecord(2)[0],
      ),
    ),
  ).toThrow("inquiry");
  const model = aplusFixtureModelPage([aplusFixtureRecord(1)]);
  expect(() =>
    parseAplusModel(
      model.replace(
        "<b>Make/Model :</b> ACURA ILX",
        "<b>Make/Model :</b> ACURA RDX",
      ),
      aplusFixtureMake,
      aplusFixtureModel,
    ),
  ).toThrow("inquiry");
  expect(() =>
    parseAplusRoot(
      model.replace("</body>", "<nav>Recent Arrivals</nav></body>"),
    ),
  ).toThrow("latest-arrival surface");
});

test("A Plus binds case-insensitive native empty h1 headings and decodes numeric punctuation", () => {
  const make = { ...aplusFixtureMake, path: "/parts/TOYOTA", label: "TOYOTA" };
  const model = {
    ...aplusFixtureModel,
    path: "/parts/TOYOTA/86/",
    label: "86",
  };
  expect(
    parseAplusModel(
      aplusFixtureModelPage([], "Used  toyota 86  Parts"),
      make,
      model,
    ).records,
  ).toEqual([]);
  expect(() =>
    parseAplusModel(
      aplusFixtureModelPage([], "Used toyota CAMRY Parts"),
      make,
      model,
    ),
  ).toThrow("another published model");
  expect(
    parseAplusModel(
      aplusFixtureModelPage([aplusFixtureRecord(1)]),
      aplusFixtureMake,
      aplusFixtureModel,
    ).records,
  ).toHaveLength(1);
});

test("A Plus makes repeated or oversized optional fields nullable while holding required contradictions", () => {
  const record = aplusFixtureRecord(1);
  record[5] = "ST1/ST1_1.jpg";
  record[6] = "2026-10-22";
  const raw = aplusFixtureRoot([record]);
  const optional = raw
    .replace(
      "<b>Stock:</b> ST1<br/>",
      "<b>Stock:</b> ST1<br/><b>Stock:</b> OTHER<br/>",
    )
    .replace(
      "<b>Enter Date:</b> 2026-10-22<br/>",
      "<b>Enter Date:</b> 2026-10-22<br/><b>Enter Date:</b> 2026-10-23<br/>",
    );
  expect(parseAplusRoot(optional).records[0]).toEqual([
    record[0],
    record[1],
    record[2],
    "",
    record[4],
    null,
    null,
  ]);
  expect(
    parseAplusRoot(
      raw.replace(
        "<b>Stock:</b> ST1<br/>",
        `<b>Stock:</b> ${"A".repeat(101)}<br/>`,
      ),
    ).records[0]?.[3],
  ).toBe("");
  expect(
    parseAplusRoot(
      raw.replace(
        "<img src=",
        '<img data-src="https://example.com/conflict.jpg" src=',
      ),
    ).records[0]?.[5],
  ).toBeNull();
  expect(() =>
    parseAplusRoot(
      raw.replace(
        "<b>Year:</b> 2003<br/>",
        "<b>Year:</b> 2003<br/><b>Year:</b> 2004<br/>",
      ),
    ),
  ).toThrow("Conflicting required");
});
