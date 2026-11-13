import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  parsePrattArrivals,
  parsePrattDirectory,
  parsePrattModel,
} from "./pratt-parser";
import { transformPrattRecord } from "./pratt-transform";
import { PrattRecord } from "./pratt-record";
import { prattClass, prattElements } from "./pratt-html";
import {
  prattFixtureContract,
  prattFixtureLexus,
  prattValue,
} from "./pratt-test-fixtures";

const fixture = (name: string) =>
  readFileSync(
    new URL("./pratt-test-fixtures/" + name, import.meta.url),
    "utf8",
  );
test("Pratt real Lexus slice preserves the published leaf and transforms the complete native identity", () => {
  const page = parsePrattModel(fixture("model-lexus.html"), {
    make: { path: "/parts/LEXUS", label: "LEXUS", count: 10 },
    model: {
      path: "/parts/LEXUS/LEXUS_LS460/",
      label: "LEXUS LS460",
      count: 2,
    },
  });
  expect(page.ok).toBe(true);
  if (!page.ok) throw new Error(page.error.message);
  expect(page.value.records).toHaveLength(2);
  const record = page.value.records[0];
  if (!record) throw new Error("Real saved Lexus card missing");
  const assessed = transformPrattRecord(record, page.value.context, {
    code: "fixture-hoxie",
    name: "Pratt's Auto Salvage",
    city: "Hoxie",
    lat: 36.0533113,
    lng: -90.9844769,
  });
  expect(assessed.status).toBe("available");
  if (assessed.status !== "available")
    throw new Error("Real saved Lexus identity rejected");
  expect(assessed.vehicle).toMatchObject({
    source: "pratt",
    vin: "JTHBL5EF7C5113721",
    year: 2012,
    make: "Lexus",
    model: "LS460",
    detailsUrl:
      "https://prattsautosalvage.com/parts/LEXUS/LEXUS_LS460/J60711/2012",
  });
  expect(assessed.nativeIdentity).toEqual({
    make: "LEXUS",
    model: "LS460",
    leaf: "LEXUS LS460",
  });
});

test("Pratt preserves every literal make/model control and dedicated badge", () => {
  const makes = prattValue(
    parsePrattDirectory(fixture("makes.html"), { kind: "makes" }),
  );
  expect(makes).toHaveLength(47);
  expect(
    makes.filter((make) => make.label === "DODGE").map((make) => make.path),
  ).toEqual(["/parts/DODGE", "/parts/DODGE_"]);
  const models = prattValue(
    parsePrattDirectory(fixture("models-lexus.html"), {
      kind: "models",
      make: prattFixtureLexus.make,
    }),
  );
  expect(
    models.find((model) => model.path === prattFixtureLexus.model.path),
  ).toEqual(prattFixtureLexus.model);
  expect(
    parsePrattDirectory(
      fixture("models-lexus.html").replace(
        '<span class="badge badge-light">2</span>',
        "",
      ),
      { kind: "models", make: prattFixtureLexus.make },
    ).ok,
  ).toBe(false);
});
test("Pratt native explicit empty is terminal despite its published nonzero badge", () => {
  const page = prattValue(
    parsePrattModel(fixture("empty-chrysler.html"), {
      make: { path: "/parts/CHRYSLER", label: "CHRYSLER", count: 140 },
      model: {
        path: "/parts/CHRYSLER/TOWN_-and_COUNTRY/",
        label: "TOWN & COUNTRY",
        count: 34,
      },
    }),
  );
  expect(page.records).toEqual([]);
  expect(page.nativeEmpty).toBe(true);
  expect(page.context.kind).toBe("model");
});
test("Pratt explicit SMART leaf equal to make is accepted without a blanket equality gate", () => {
  const page = prattValue(
    parsePrattModel(fixture("model-smart.html"), {
      make: { path: "/parts/SMART", label: "SMART", count: 3 },
      model: { path: "/parts/SMART/SMART/", label: "SMART", count: 3 },
    }),
  );
  expect(page.records).toHaveLength(3);
  for (const record of page.records) {
    const result = transformPrattRecord(
      record,
      page.context,
      prattFixtureContract.yard,
    );
    expect(result.status).toBe("available");
    if (result.status === "available")
      expect(result.vehicle).toMatchObject({ make: "Smart", model: "SMART" });
  }
});
test("Pratt preserves missing fields and readable VIN presence without route or inquiry backfill", () => {
  for (const [original, replacement] of [
    ["<b>Year:</b> 2012", "<b>Year:</b> "],
    ["<b>Make/Model :</b> LEXUS LS460", "<b>Make/Model :</b> "],
    ["<b>Vin :</b> JTHBL5EF7C5113721", "<b>Vin :</b> "],
  ] as const) {
    const page = prattValue(
      parsePrattModel(
        fixture("model-lexus.html").replace(original, replacement),
        prattFixtureLexus,
      ),
    );
    const record = page.records[0];
    if (!record) throw new Error("Saved Lexus row missing");
    const assessment = PrattRecord.assess(record, page.context);
    expect(assessment.reasons.length).toBeGreaterThan(0);
    expect(assessment.validVinClaims).toContain("JTHBL5EF7C5113721");
  }
});
test("Pratt rejects 500 cards, broken boundaries, supplier changes and unread native continuation", () => {
  const raw = fixture("model-lexus.html");
  const deck = prattElements(raw, "div", (tag) =>
    prattClass(tag, "card-deck"),
  )[0];
  const card = prattElements(raw, "div", (tag) =>
    prattClass(tag, "card-price"),
  )[0];
  if (!deck || !card) throw new Error("Saved Lexus card/deck missing");
  const boundary = parsePrattModel(
    raw.replace(deck.body, (card.tag + card.body + "</div>").repeat(500)),
    prattFixtureLexus,
  );
  expect(boundary.ok).toBe(false);
  if (!boundary.ok)
    expect(boundary.error.message).toContain("500-card boundary");
  for (const changed of [
    raw.replace("</body>", ""),
    raw.replace("AR18", "FOREIGN"),
    raw.replace(
      '<div class="card-deck">',
      '<a href="?page=2" rel="next">Next</a><div class="card-deck">',
    ),
    raw.replace('class="card card-price"', 'class="card"'),
  ])
    expect(parsePrattModel(changed, prattFixtureLexus).ok).toBe(false);
});
test("Pratt arrival model comes only from its complete native label while preserving unusual literal routes", () => {
  const page = prattValue(parsePrattArrivals(fixture("arrivals.html")));
  expect(page.records).toHaveLength(60);
  const record = page.records.find((row) => row.stock === "J60658");
  if (!record) throw new Error("Saved Chrysler arrival missing");
  const result = transformPrattRecord(
    record,
    page.context,
    prattFixtureContract.yard,
  );
  expect(result.status).toBe("available");
  if (result.status === "available")
    expect(result.vehicle).toMatchObject({
      model: "TOWN & COUNTRY",
      detailsUrl:
        "https://prattsautosalvage.com/parts/CHRYSLER/TOWN_and__COUNTRY/J60658/2012",
    });
});

test("Pratt rejects the real BURNT older-serial placeholder without VIN decoding", () => {
  const page = prattValue(
    parsePrattModel(fixture("model-corvette.html"), {
      make: { path: "/parts/CHEVROLET", label: "CHEVROLET", count: 1341 },
      model: {
        path: "/parts/CHEVROLET/CORVETTE/",
        label: "CORVETTE",
        count: 8,
      },
    }),
  );
  const record = page.records.find((row) => row.stock === "2G0284");
  if (!record) throw new Error("Saved 1965 Corvette row missing");
  expect(record.vins).toEqual(["BURNT"]);
  const result = transformPrattRecord(
    record,
    page.context,
    prattFixtureContract.yard,
  );
  expect(result.status).toBe("rejected");
  expect(result.reasons).toEqual(["missing-or-invalid-native-vin"]);
  expect(result.validVinClaims).toEqual([]);
});
