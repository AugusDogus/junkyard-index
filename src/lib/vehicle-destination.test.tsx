import { describe, expect, test } from "bun:test";
import { render } from "@react-email/components";
import { renderToStaticMarkup } from "react-dom/server";
import { VehicleCard } from "~/components/search/VehicleCard";
import { NewVehiclesAlert } from "~/emails/NewVehiclesAlert";
import { parseNotificationIntentPayload } from "~/server/alerts/notification-intent-payload";
import { formatVehicleEmbed } from "./discord-vehicle-embed";
import { SearchAlertMatch } from "./search-alert-data";
import { algoliaHitToSearchVehicle } from "./search-vehicles";
import type { DataSource, SearchVehicle } from "./types";
import { VehicleDestination } from "./vehicle-destination";

function vehicle(source: DataSource, detailsUrl: unknown): SearchVehicle {
  const result = algoliaHitToSearchVehicle({
    objectID: "vehicle-1",
    source,
    detailsUrl,
    vin: "3N69R9M338069",
    year: 1979,
    make: "Oldsmobile",
    model: "Eighty Eight",
    locationName: "Example Yard",
    locationCity: "Detroit",
    stateAbbr: "MI",
    stockNumber: "STK123",
    availableDate: "2026-09-16",
    imageUrl: null,
  });
  if (!result) throw new Error("Expected supported fixture source");
  return result;
}

function roundTripNotification(vehicle: SearchVehicle): SearchVehicle {
  const data = parseNotificationIntentPayload(
    JSON.stringify({
      searchName: "Oldsmobile",
      query: "",
      searchUrl: "https://junkyardindex.com/search",
      searchId: "search-1",
      match: SearchAlertMatch.create(1, [vehicle]),
    }),
  );
  const restored = data.match.previewVehicles[0];
  if (!restored) throw new Error("Expected notification preview vehicle");
  return restored;
}

async function renderSurfaces(vehicle: SearchVehicle) {
  const email = await render(
    <NewVehiclesAlert
      digest={{
        previewAlerts: [
          {
            searchName: "Oldsmobile",
            query: "",
            match: SearchAlertMatch.create(1, [vehicle]),
            searchUrl: "https://junkyardindex.com/search",
            unsubscribeUrl: "https://junkyardindex.com/unsubscribe",
          },
        ],
        alertCount: 1,
        vehicleCount: 1,
      }}
      manageSearchesUrl="https://junkyardindex.com/settings"
    />,
  );
  const card = renderToStaticMarkup(<VehicleCard vehicle={vehicle} />);
  expect(card).not.toContain('href=""');
  expect(email).not.toContain('href=""');
  return { card, email, discord: formatVehicleEmbed(vehicle) };
}

const manualProviders = [
  ["pullnsave", "https://www.pullnsave.com/inventory/"],
  ["tearapart", "https://tearapart.com/inventory/"],
  ["upullrparts", "https://upullrparts.com/inventory/"],
  ["partsgalore", "https://parts-galore.com/inventory/"],
] as const;

describe("manual provider destinations across search, durable alerts and presentation", () => {
  for (const [source, inventoryUrl] of manualProviders) {
    test.each([null, "", inventoryUrl, `${inventoryUrl}?stock=STK123`])(
      `${source}: renders an honest search action for stored URL %j`,
      async (detailsUrl) => {
        const restored = roundTripNotification(vehicle(source, detailsUrl));
        const { card, email, discord } = await renderSurfaces(restored);
        for (const html of [card, email]) {
          expect(html).toContain(`href="${inventoryUrl}"`);
          expect(html).toContain("Search provider inventory");
          expect(html).toContain("Select make/model");
          expect(html).toContain(restored.vin);
          expect(html).not.toContain("?stock=");
          expect(html).not.toContain("View vehicle");
          expect(html).not.toContain("View inventory");
        }
        expect(card).toContain("Copy VIN");
        expect(discord.url).toBeUndefined();
        expect(discord.description).toContain(
          `[Search provider inventory](${inventoryUrl})`,
        );
        expect(discord.description).toContain("Select make/model");
        expect(discord.fields).toContainEqual({
          name: "VIN",
          value: restored.vin,
          inline: false,
        });
      },
    );
  }

  test("does not offer to copy a missing VIN", async () => {
    const { card, email, discord } = await renderSurfaces({
      ...vehicle("pullnsave", null),
      vin: " ",
    });
    expect(card).not.toContain("Copy VIN");
    expect(email).not.toContain("VIN:");
    expect(discord.fields?.some((field) => field.name === "VIN")).toBe(false);
  });
});

describe("working destinations", () => {
  test.each([
    [
      "wrenchapart",
      "https://wrenchapart.com/vehicle-info/1N4AA5AP3AC800856",
      "View vehicle",
    ],
    [
      "ipullupull",
      "https://ipullupull.com/inventory-pricing/?ipull_inventory_pricing_search=STK057825&ipull_inventory_pricing_filter%5Byard_city%5D=STOCKTON",
      "View matching inventory",
    ],
    [
      "upullitwa",
      "https://go2upullit.com/inventory/ANY/ANY/?k=1&id=1090&view=table&search=1122642450",
      "View matching inventory",
    ],
    [
      "row52",
      "https://row52.com/Vehicle/Index/3N69R9M338069",
      "View inventory",
    ],
    [
      "pyp",
      "https://www.lkqpickyourpart.com/inventory/anaheim-1264/1979-oldsmobile-eighty-eight/",
      "View inventory",
    ],
    ["autorecycler", "https://autorecycler.com/details/123", "View inventory"],
    [
      "pullapart",
      "https://www.pullapart.com/inventory/vehicle/123",
      "View inventory",
    ],
    [
      "upullitne",
      "https://upullitne.com/search-inventory/?stock=LCN062459",
      "View inventory",
    ],
    [
      "upullitdavie",
      "https://upullit.com/inventory?q=3N69R9M338069",
      "View inventory",
    ],
    [
      "gopullit",
      "https://gopullit.com/inventory/gpi0331270/",
      "View inventory",
    ],
  ] as const)(
    "preserves %s URL and label without manual search",
    async (source, href, label) => {
      const { card, email, discord } = await renderSurfaces(
        roundTripNotification(vehicle(source, href)),
      );
      for (const html of [card, email]) {
        expect(html).toContain(`href="${href.replaceAll("&", "&amp;")}"`);
        expect(html).toContain(label);
        expect(html).not.toContain("Search provider inventory");
        expect(html).not.toContain("Copy VIN");
      }
      expect(discord.url).toBe(href);
      expect(discord.description).toBe(`[${label}](${href})`);
    },
  );
});

describe("absent or unusable destinations", () => {
  test.each([null, undefined, "", "  ", 42])(
    "keeps absence as null through mapping and alerts: %j",
    (value) => {
      const mapped = vehicle("row52", value);
      expect(mapped.detailsUrl).toBeNull();
      expect(roundTripNotification(mapped).detailsUrl).toBeNull();
    },
  );

  test.each([
    null,
    "",
    " ",
    "not-a-url",
    "javascript:alert(1)",
    "//example.com",
  ])(
    "does not turn an unusable link into a self-link: %j",
    async (detailsUrl) => {
      // Old queued payloads may still contain empty strings.
      const restored = roundTripNotification({
        ...vehicle("row52", null),
        detailsUrl,
      });
      expect(VehicleDestination.resolve(restored).kind).toBe("unavailable");
      const { card, email, discord } = await renderSurfaces(restored);
      expect(card).not.toContain("href=");
      expect(card).toContain("Provider link unavailable");
      expect(email).toContain("Provider link unavailable");
      expect(email).not.toContain("View inventory");
      expect(discord.url).toBeUndefined();
      expect(discord.description).toContain("Provider link unavailable");
      expect(discord.description).not.toContain("](");
    },
  );
});
