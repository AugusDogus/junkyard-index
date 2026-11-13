import { expect, test } from "bun:test";
import {
  parseCoutuHome,
  parseCoutuDirectory,
  parseCoutuModel,
} from "./coutu-parser";
import {
  coutuFixtureHome,
  coutuFixtureMake,
  coutuFixtureModel,
  coutuFixtureRecord,
  coutuFixtureDirectory,
  coutuFixtureModelPage,
} from "./coutu-test-fixtures";

test("Coutu reads literal graph controls and server-rendered donor cards, ignoring parts badges", () => {
  expect(parseCoutuHome(coutuFixtureHome)).toMatch(/^[a-f0-9]{64}$/);
  expect(
    parseCoutuDirectory(coutuFixtureDirectory([coutuFixtureMake]), "makes"),
  ).toEqual([coutuFixtureMake]);
  expect(
    parseCoutuDirectory(
      coutuFixtureDirectory([coutuFixtureModel], coutuFixtureMake),
      "models",
      coutuFixtureMake,
    ),
  ).toEqual([coutuFixtureModel]);
  const record = coutuFixtureRecord(1);
  expect(
    parseCoutuModel(
      coutuFixtureModelPage([record]),
      coutuFixtureMake,
      coutuFixtureModel,
      ["FORD"],
    ).records,
  ).toEqual([record]);
});

test("Coutu fails closed on numeric, labelled, query and semantic continuation controls", () => {
  const source = coutuFixtureModelPage([coutuFixtureRecord(1)]);
  for (const navigation of [
    '<a href="/browse/ford/f250/2">2</a>',
    "<button>2</button>",
    '<nav aria-label="Pagination"></nav>',
    '<a rel="next" href="/browse/ford/f250">Continue</a>',
    '<a rel="next nofollow" href="/browse/ford/f250/2">›</a>',
    '<a aria-label="Next page" href="/browse/ford/f250/2">›</a>',
    '<a href="?cursor=2">Continue</a>',
    "<button>Load More</button>",
  ])
    expect(() =>
      parseCoutuModel(
        source.replace("</main>", navigation + "</main>"),
        coutuFixtureMake,
        coutuFixtureModel,
        ["FORD"],
      ),
    ).toThrow(/pagination|continuation/);
});

test("Coutu keeps conflicting header claims and literal make-equals-model labels", () => {
  const make = { path: "/browse/international", label: "INTERNATIONAL" };
  const model = {
    path: "/browse/international/international",
    label: "INTERNATIONAL",
  };
  const record = coutuFixtureRecord(1);
  record[0] = "383208H879516";
  record[1] = record[2] = "1969";
  record[3] = record[4] = record[5] = record[6] = "INTERNATIONAL";
  expect(
    parseCoutuModel(coutuFixtureModelPage([record], make, model), make, model, [
      "INTERNATIONAL",
    ]).records,
  ).toEqual([record]);
  const conflict = coutuFixtureRecord(2);
  conflict[3] = "GMC";
  expect(
    parseCoutuModel(
      coutuFixtureModelPage([conflict]),
      coutuFixtureMake,
      coutuFixtureModel,
      ["FORD", "GMC"],
    ).records[0]?.[3],
  ).toBe("GMC");
});

test("Coutu rejects truncated documents, changed ownership, wrong graph bindings and denominator changes", () => {
  const body = coutuFixtureModelPage([coutuFixtureRecord(1)]);
  for (const changed of [
    body.replace("</html>", ""),
    body.replace("1535 W Main St", "other address"),
    body.replace("Browse by Vehicles (1)", "Browse by Vehicles (2)"),
    body.replace(
      '<a href="/browse/ford/f250">F250</a>',
      '<a href="/browse/ford/f350">F350</a>',
    ),
  ])
    expect(() =>
      parseCoutuModel(changed, coutuFixtureMake, coutuFixtureModel, ["FORD"]),
    ).toThrow();
});
