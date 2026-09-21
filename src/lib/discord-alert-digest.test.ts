import { expect, test } from "bun:test";
import { formatDiscordDigest } from "./discord-alert-digest";
import { SearchAlertDigest, SearchAlertMatch } from "./search-alert-data";
import { algoliaHitToSearchVehicle } from "./search-vehicles";

const manageUrl = "https://example.com/settings/searches";

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
  expect(embeds).toHaveLength(10);
  expect(embeds[0]?.description).toContain("78");
  expect(embeds[0]?.description).toContain("12");
  expect(embeds[0]?.url).toBe(manageUrl);
  expect(embeds[0]?.footer?.text).toContain("3 more saved searches");
  expect(embeds.every((embed) => (embed.title?.length ?? 0) <= 256)).toBe(true);
  expect(
    embeds.reduce(
      (sum, embed) =>
        sum +
        (embed.title?.length ?? 0) +
        (embed.description?.length ?? 0) +
        (embed.footer?.text.length ?? 0),
      0,
    ),
  ).toBeLessThan(6000);
});

test("preserves vehicle previews for a single saved search", () => {
  const vehicle = algoliaHitToSearchVehicle({
    objectID: "JG1MR2158JK724014",
    source: "row52",
    year: 1988,
    make: "Chevrolet",
    model: "Sprint",
  });
  if (!vehicle) throw new Error("Expected a vehicle fixture");
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
