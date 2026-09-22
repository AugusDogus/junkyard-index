import { expect, test } from "bun:test";
import type { APIEmbed } from "discord-api-types/v10";
import { formatDiscordDigest } from "./discord-alert-digest";
import { SearchAlertDigest, SearchAlertMatch } from "./search-alert-data";
import { algoliaHitToSearchVehicle } from "./search-vehicles";
import type { SearchVehicle } from "./types";

const manageUrl = "https://example.com/settings/searches";

function embedTextLength(embed: APIEmbed): number {
  return (
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.footer?.text.length ?? 0) +
    (embed.author?.name.length ?? 0) +
    (embed.fields?.reduce(
      (sum, field) => sum + field.name.length + field.value.length,
      0,
    ) ?? 0)
  );
}

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

test("summarizes all searches in one Discord message within its embed limits", () => {
  const digest = SearchAlertDigest.fromAlerts(
    Array.from({ length: 12 }, (_, i) => ({
      searchId: String(i),
      searchName: "A".repeat(300),
      query: "",
      searchUrl: `https://example.com/search?q=${i}`,
      match: SearchAlertMatch.create(i + 1, []),
    })),
  );
  const embeds = formatDiscordDigest(digest, manageUrl);
  expect(embeds).toHaveLength(1);
  expect(embeds[0]?.description).toContain("78");
  expect(embeds[0]?.description).toContain("12");
  expect(embeds[0]?.url).toBe(manageUrl);
  expect(embeds[0]?.footer?.text).toContain("2 more saved searches");
  expect(embeds.every((embed) => (embed.title?.length ?? 0) <= 256)).toBe(true);
  expect(
    embeds.reduce((sum, embed) => sum + embedTextLength(embed), 0),
  ).toBeLessThan(6000);
});

test("preserves vehicle previews for a single saved search", () => {
  const vehicle = vehicleFixture({
    objectID: "JG1MR2158JK724014",
    year: 1988,
    make: "Chevrolet",
    model: "Sprint",
    imageUrl: undefined,
  });
  const digest = SearchAlertDigest.fromAlerts([
    {
      searchId: "search-1",
      searchName: "Sprint",
      query: "",
      searchUrl: "https://example.com/search",
      match: SearchAlertMatch.create(1, [vehicle]),
    },
  ]);
  const embeds = formatDiscordDigest(digest, manageUrl);
  expect(embeds).toHaveLength(2);
  expect(embeds[1]?.title).toBe("1988 Chevrolet Sprint");
});

test("includes vehicle image previews when multiple saved searches match", () => {
  const digest = SearchAlertDigest.fromAlerts([
    {
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
    },
    {
      searchId: "v8",
      searchName: "Volvo 2005-9 V8",
      query: "volvo",
      searchUrl: "https://example.com/search?q=v8",
      match: SearchAlertMatch.create(1, [
        vehicleFixture({
          objectID: "volvo-v8",
          year: 2006,
          model: "XC90",
          imageUrl: "https://cdn.example/xc90.jpg",
        }),
      ]),
    },
  ]);

  const embeds = formatDiscordDigest(digest, manageUrl);

  expect(embeds[0]?.title).toBe("Daily saved search update");
  expect(embeds[0]?.description).toContain("3");
  expect(embeds[0]?.description).toContain("2");
  expect(embeds[0]?.description).toContain("pre-2000 volvo");
  expect(embeds[0]?.description).toContain("Volvo 2005-9 V8");
  expect(
    embeds.some((embed) =>
      embed.description?.includes("Open this search to view matches"),
    ),
  ).toBe(false);
  expect(embeds.map((embed) => embed.title)).toEqual([
    "Daily saved search update",
    "1998 Volvo V70",
    "1992 Volvo 240",
    "2006 Volvo XC90",
  ]);
  expect(embeds.slice(1).map((embed) => embed.thumbnail?.url)).toEqual([
    "https://cdn.example/v70.jpg",
    "https://cdn.example/240.jpg",
    "https://cdn.example/xc90.jpg",
  ]);
  expect(embeds[1]?.footer?.text).toBe("From pre-2000 volvo");
  expect(embeds[3]?.footer?.text).toBe("From Volvo 2005-9 V8");
  expect(
    embeds.reduce((sum, embed) => sum + embedTextLength(embed), 0),
  ).toBeLessThan(6000);
});

test("still shows vehicle cards when a multi-search digest has no photos", () => {
  const digest = SearchAlertDigest.fromAlerts([
    {
      searchId: "search-1",
      searchName: "pre-2000 volvo",
      query: "",
      searchUrl: "https://example.com/search/1",
      match: SearchAlertMatch.create(1, [
        vehicleFixture({ objectID: "no-photo", imageUrl: undefined }),
      ]),
    },
    {
      searchId: "search-2",
      searchName: "Volvo 2005-9 V8",
      query: "",
      searchUrl: "https://example.com/search/2",
      match: SearchAlertMatch.create(1, [
        vehicleFixture({
          objectID: "also-no-photo",
          year: 2006,
          model: "XC90",
          imageUrl: undefined,
        }),
      ]),
    },
  ]);

  const embeds = formatDiscordDigest(digest, manageUrl);
  expect(embeds.map((embed) => embed.title)).toEqual([
    "Daily saved search update",
    "1998 Volvo V70",
    "2006 Volvo XC90",
  ]);
  expect(embeds.slice(1).every((embed) => embed.thumbnail === undefined)).toBe(
    true,
  );
});
