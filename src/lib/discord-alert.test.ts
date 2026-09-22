import { expect, test } from "bun:test";
import { formatDiscordAlert } from "./discord-alert";
import { SearchAlertMatch } from "./search-alert-data";
import { algoliaHitToSearchVehicle } from "./search-vehicles";
import type { SearchVehicle } from "./types";

function vehicleFixture(
  overrides: Record<string, unknown> = {},
): SearchVehicle {
  const vehicle = algoliaHitToSearchVehicle({
    objectID: "JG1MR2158JK724014",
    source: "row52",
    year: 1998,
    make: "Volvo",
    model: "V70",
    imageUrl: "https://cdn.example/v70.jpg",
    locationName: "Wrench-A-Part - Roosevelt",
    locationCity: "San Antonio",
    stateAbbr: "TX",
    ...overrides,
  });
  if (!vehicle) throw new Error("Expected a vehicle fixture");
  return vehicle;
}

test("restores the pre-digest per-search vehicle preview message", () => {
  const vehicle = vehicleFixture({
    objectID: "JG1MR2158JK724014",
    year: 1998,
    model: "V70",
  });
  const embeds = formatDiscordAlert({
    searchId: "pre-2000",
    searchName: "pre-2000 volvo",
    query: "volvo",
    searchUrl: "https://example.com/search?q=volvo",
    match: SearchAlertMatch.create(1, [vehicle]),
  });

  expect(embeds).toHaveLength(2);
  expect(embeds[0]).toMatchObject({
    title: "New Vehicles Found: pre-2000 volvo",
    description: 'Found **1** new vehicle matching your search for "volvo".',
    url: "https://example.com/search?q=volvo",
  });
  expect(embeds[1]?.title).toBe("1998 Volvo V70");
  expect(embeds[1]?.thumbnail?.url).toBe("https://cdn.example/v70.jpg");
});

test("formats each saved search as its own preview message", () => {
  const first = formatDiscordAlert({
    searchId: "pre-2000",
    searchName: "pre-2000 volvo",
    query: "volvo",
    searchUrl: "https://example.com/search?q=volvo",
    match: SearchAlertMatch.create(2, [
      vehicleFixture({
        objectID: "volvo-v70",
        year: 1998,
        model: "V70",
        imageUrl: "https://cdn.example/v70.jpg",
      }),
      vehicleFixture({
        objectID: "volvo-240",
        year: 1992,
        model: "240",
        imageUrl: "https://cdn.example/240.jpg",
      }),
    ]),
  });
  const second = formatDiscordAlert({
    searchId: "v8",
    searchName: "Volvo 2005-9 V8",
    query: "",
    searchUrl: "https://example.com/search?q=v8",
    match: SearchAlertMatch.create(1, [
      vehicleFixture({
        objectID: "volvo-v8",
        year: 2006,
        model: "XC90",
        imageUrl: "https://cdn.example/xc90.jpg",
      }),
    ]),
  });

  expect(first.map((embed) => embed.title)).toEqual([
    "New Vehicles Found: pre-2000 volvo",
    "1998 Volvo V70",
    "1992 Volvo 240",
  ]);
  expect(first.slice(1).map((embed) => embed.thumbnail?.url)).toEqual([
    "https://cdn.example/v70.jpg",
    "https://cdn.example/240.jpg",
  ]);
  expect(second.map((embed) => embed.title)).toEqual([
    "New Vehicles Found: Volvo 2005-9 V8",
    "2006 Volvo XC90",
  ]);
  expect(second[1]?.thumbnail?.url).toBe("https://cdn.example/xc90.jpg");
  expect(
    [...first, ...second].some((embed) =>
      embed.description?.includes("Open this search to view matches"),
    ),
  ).toBe(false);
});

test("keeps a vehicle card when the match has no photo", () => {
  const embeds = formatDiscordAlert({
    searchId: "search-1",
    searchName: "Sprint",
    query: "",
    searchUrl: "https://example.com/search",
    match: SearchAlertMatch.create(1, [
      vehicleFixture({
        objectID: "JG1MR2158JK724014",
        year: 1988,
        make: "Chevrolet",
        model: "Sprint",
        imageUrl: undefined,
      }),
    ]),
  });

  expect(embeds).toHaveLength(2);
  expect(embeds[1]?.title).toBe("1988 Chevrolet Sprint");
  expect(embeds[1]?.thumbnail).toBeUndefined();
});
