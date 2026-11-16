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

test.each(["MO38", "MO09", "OO95"])(
  "Midway manual inventory links retain yard %s",
  (yard) => {
    const href = `https://midwayupull.com/inventory/ANY/ANY/?k=1&id=${yard}&view=table`;
    expect(
      VehicleDestination.resolve({ source: "midway", detailsUrl: href }),
    ).toMatchObject({ kind: "manual-search", href });
  },
);

test.each(["pickerstxk.com", "pickerslongview.com", "pickersreno.com"])(
  "Pickers manual inventory links retain the physical yard %s",
  (host) => {
    const href = `https://${host}/Home/Inventory`;
    expect(
      VehicleDestination.resolve({ source: "pickers", detailsUrl: href }),
    ).toMatchObject({ kind: "manual-search", href });
  },
);

test("Indian River uses the searchable catalog instead of shared paperwork URLs", () => {
  expect(
    VehicleDestination.resolve({
      source: "indianriver",
      detailsUrl: "https://indianriverautosalvage.com/inventory/title-",
    }),
  ).toMatchObject({
    kind: "manual-search",
    href: "https://indianriverautosalvage.com/inventory-3/",
    explanation: expect.stringContaining("VIN or serial number"),
  });
});

test("S&W directs users to its searchable report and preserves the cached-inventory caveat", () => {
  expect(
    VehicleDestination.resolve({ source: "sandw", detailsUrl: null }),
  ).toEqual({
    kind: "manual-search",
    href: "https://www.sandwauto.com/inventory-search",
    label: "Search provider inventory",
    explanation:
      "Search the yard inventory by VIN or stock number, then confirm availability with S&W. The provider may serve cached inventory.",
  });
});

test.each([
  null,
  "",
  "https://chasencarsauto.com/inventory/",
  "https://chasencarsauto.com/inventory/?stock=STK123",
])(
  "Chase N Cars uses VIN and stock matching for stored URL %j",
  async (detailsUrl) => {
    const restored = roundTripNotification(vehicle("chasencars", detailsUrl));
    const { card, email, discord } = await renderSurfaces(restored);
    expect(VehicleDestination.resolve(restored)).toMatchObject({
      kind: "manual-search",
      href: "https://chasencarsauto.com/inventory/",
      explanation: expect.stringContaining("VIN or stock number"),
    });
    for (const html of [card, email]) {
      expect(html).toContain('href="https://chasencarsauto.com/inventory/"');
      expect(html).toContain("Search provider inventory");
      expect(html).toContain("VIN or stock number");
      expect(html).not.toContain("View inventory");
    }
    expect(discord.url).toBeUndefined();
    expect(discord.description).toContain(
      "[Search provider inventory](https://chasencarsauto.com/inventory/)",
    );
    expect(discord.description).toContain("VIN or stock number");
  },
);

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
  ["upullitne", "https://upullitne.com/search-inventory/"],
  ["pullnsave", "https://www.pullnsave.com/inventory/"],
  ["tearapart", "https://tearapart.com/inventory/"],
  ["upullrparts", "https://upullrparts.com/inventory/"],
  ["partsgalore", "https://parts-galore.com/inventory/"],
  ["nvpap", "https://nvpap.com/part-interchange.html"],
  ["midway", "https://midwayupull.com/inventory/"],
] as const;

describe("manual provider destinations across search, durable alerts and presentation", () => {
  test.each([
    [
      "mccauley",
      "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2003-acura-mdx.html",
    ],
    [
      "mccauley",
      "https://www.mccauleysauto.com/pick-a-part-list-of-parts-vehicles",
    ],
    [
      "rustyhook",
      "http://salvage.rustyhooktowing.com/index.php?E=Detail&ID=25",
    ],
    ["aviation", "https://aviationauto.com/used-parts/ACURA/ILX/RR116/2020"],
    ["chaz", "https://www.chazsauto.com/parts/MITSUBISHI/MIRAGE/HXY070/2017"],
    ["citymotors", "https://citymotorsparts.com/cars/2025-bmw-m2-2/"],
    ["cars4parts", "https://cars4parts.carzrus1.com/inventory/quest/"],
    [
      "brandywine",
      "https://www.brandywineupullit.com/veh_single/?stockno=08A455",
    ],
    [
      "cstruck",
      "https://www.heavytruckparts.net/item/Peterbilt/379/Vehicle-For-Sale/7131988/1/5528",
    ],
    ["rmmdtp", "https://rmmdtp.com/truck-description/?truck=196423"],
    ["hawaiiparts", "https://aloha.parts/pages/yard#car-4t1bf1fk8fu473924"],
    [
      "modernmuscle",
      "https://modernmusclesalvage.com/pages/shop-by-vehicle?stock=2247",
    ],
    ["oemgarage", "https://oe-mgarage.com/collections/donor-636"],
    ["allied", "https://alliedautowrecking.com/parts/HONDA/CIVIC/21D078/2017"],
    ["jimsimport", "https://jimsimport.com/used-parts/ACURA/ILX/21F104/2020"],
    [
      "lonestarimports",
      "https://www.lonestarimport.com/new-arrivals?stock=LS11016",
    ],
    [
      "hollanderstores",
      "https://leblancsauto.hollanderstores.com/VehicleDealerShowParts/4573/72737080",
    ],
    [
      "alshned",
      "https://alshnedauto.com/products/donor-vehicle-2016-nissan-murano-platinum-brown",
    ],
    [
      "kandr",
      "https://kandrtruckparts.com/results-page/?page_number=1&keywords=&part_type=99994&manufacturer=&model=&category=&year_start=0&year_end=0&sortby=price&sortorder=DESC&zip=&distance=&result_size=25&more=6483483%2F1%2F2441426",
    ],
    [
      "hagerman",
      "https://hagermanparts.com/item/international/9200/dismantled-vehicles/1125862/1/8012/",
    ],
    [
      "weberbrothers",
      "https://www.weberbrothersauto.com/product/2025-nissan-murano-b2b370/",
    ],
    [
      "dutchers",
      "https://www.heavytruckparts.net/item/Mack/Gu713/Complete-Vehicle/3987345/1/10961",
    ],
    ["clearsalvage", "https://clearsalvage.com/inventory/ford/"],
    ["aplus", "https://aplusauto.parts/parts/ACURA/ILX/ST1/2003"],
    ["central", "https://centralautoliq.com/used-parts/ACURA/ILX/ST1/2003"],
    ["coutu", "https://www.truckcountry.us/browse/vehicle/fixture"],
    ["kodak", "https://kodakauto.co/pull-a-part"],
    ["six03", "https://603autosalvage.com/parts-vehicles/2020-honda-civic/"],
    ["rohner", "https://rohnersautoparts.com/shop/aa0268/"],
    [
      "awap",
      "https://www.alwholesaleautoparts.com/cars-at-yard/2014-hyundai-santa-fe/",
    ],
  ] as const)(
    "%s preserves the source-linked donor destination",
    async (source, url) => {
      const restored = roundTripNotification(vehicle(source, url));
      const { card, email, discord } = await renderSurfaces(restored);
      expect(VehicleDestination.resolve(restored)).toEqual({
        kind: "inventory",
        href: url,
        label: "View inventory",
      });
      for (const html of [card, email]) {
        expect(html).toContain(`href="${url.replaceAll("&", "&amp;")}"`);
        expect(html).toContain("View inventory");
        expect(html).not.toContain("Search provider inventory");
      }
      expect(discord.url).toBe(url);
    },
  );
  test.each([
    ["pickers", "https://pickerstxk.com/Home/Inventory"],
    ["pipes", "https://www.pipesupullit.net/Home/Inventory"],
    ["uwrench", "https://uwrenchandsave.com/inventory/"],
  ] as const)(
    "%s directs users to stock matching without claiming native VINs or vehicle links",
    async (source, url) => {
      const restored = roundTripNotification(vehicle(source, null));
      const { card, email, discord } = await renderSurfaces(restored);
      for (const html of [card, email]) {
        expect(html).toContain(`href="${url}"`);
        expect(html).toContain("Search provider inventory");
        expect(html).toContain("stock number");
        expect(html).toContain("yard row");
        expect(html).not.toContain("match the VIN");
        expect(html).not.toContain("View vehicle");
      }
      expect(discord.url).toBeUndefined();
      expect(discord.description).toContain("stock number");
    },
  );
  test("Pick-A-Part Virginia directs users to search by identity and confirm the yard", async () => {
    const restored = roundTripNotification(vehicle("pickapartva", null));
    const { card, email, discord } = await renderSurfaces(restored);
    for (const html of [card, email]) {
      expect(html).toContain("https://pickapartva.com/inventory/ANY/ANY/");
      expect(html).toContain("Search provider inventory");
      expect(html).toContain("VIN or stock number");
      expect(html).toContain("confirm the matching yard");
      expect(html).not.toContain("View vehicle");
    }
    expect(discord.url).toBeUndefined();
    expect(discord.description).toContain("confirm the matching yard");
  });
  test("Millerstown directs users to its current donor PDF and printed identity", async () => {
    const url = "http://picapartyard.com/vehicles-on-premises/";
    const restored = roundTripNotification(vehicle("millerstown", null));
    const { card, email, discord } = await renderSurfaces(restored);
    for (const html of [card, email]) {
      expect(html).toContain(`href="${url}"`);
      expect(html).toContain("Search provider inventory");
      expect(html).toContain("current vehicles-on-premises PDF");
      expect(html).toContain("VIN or serial number");
      expect(html).not.toContain("View vehicle");
    }
    expect(discord.url).toBeUndefined();
    expect(discord.description).toContain("VIN or serial number");
  });
  test("Chesterfield directs users to the native Pics stock without claiming a visible VIN or vehicle link", async () => {
    const url = "https://chesterfieldauto.com/search-our-inventory-by-location";
    const restored = roundTripNotification(vehicle("chesterfield", url));
    const { card, email, discord } = await renderSurfaces(restored);
    for (const html of [card, email]) {
      expect(html).toContain(`href="${url}"`);
      expect(html).toContain("Search provider inventory");
      expect(html).toContain("open Pics and match the stock number");
      expect(html).not.toContain("then match the VIN");
      expect(html).not.toContain("View vehicle");
    }
    expect(discord.url).toBeUndefined();
    expect(discord.description).toContain(
      "open Pics and match the stock number",
    );
  });
  test.each([
    ["aero", "https://aeroautosalvage.com/vehicle-inventory/"],
    ["meeks", "https://meeksrecycling.com/pic-and-pull/"],
    ["ddauto", "https://dd-auto-parts-cars.glide.page/dl/17171d"],
    ["army", "https://armysauto.com/self-service-inventory/"],
    ["idipull", "https://ifipull.com/inventory/"],
    ["littleton", "https://littletonupullit.com/vehicle-inventory"],
    ["joliet", "https://www.jolietupullit.com/inventory"],
  ] as const)(
    "%s labels its searchable table honestly across all surfaces",
    async (source, url) => {
      const restored = roundTripNotification(vehicle(source, url));
      const { card, email, discord } = await renderSurfaces(restored);
      for (const html of [card, email]) {
        expect(html).toContain(`href="${url}"`);
        expect(html).toContain("Search provider inventory");
        expect(html).toContain("Search its inventory table");
        expect(html).not.toContain("Select make/model");
        expect(html).not.toContain("View vehicle");
      }
      expect(discord.url).toBeUndefined();
      expect(discord.description).toContain("Search its inventory table");
    },
  );
  test("Big D searches its VIN table without claiming a vehicle permalink or stock number", async () => {
    const url = "https://bigdsalvage.com/inventory/";
    const restored = roundTripNotification({
      ...vehicle("bigd", null),
      stockNumber: "",
    });
    const { card, email, discord } = await renderSurfaces(restored);
    for (const html of [card, email]) {
      expect(html).toContain(`href="${url}"`);
      expect(html).toContain("Search provider inventory");
      expect(html).toContain("Search the inventory table by VIN");
      expect(html).not.toContain("View vehicle");
      expect(html).not.toContain("stock number");
    }
    expect(discord.url).toBeUndefined();
    expect(discord.description).toContain("Search the inventory table by VIN");
  });
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
      "utpap",
      "https://utpap.com/search-inventory_ogden.php?make=CHEVROLET&model=",
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
  test("Pocatello explains hidden vehicle search across cards and alerts", async () => {
    const href =
      "https://vinplus.texnrewards.com/parts/u-pull-auto-parts-pocatello";
    const restored = roundTripNotification(vehicle("vinplus", href));
    expect(VehicleDestination.resolve(restored)).toEqual({
      kind: "unavailable",
      explanation:
        "Pocatello's public app hides vehicle search. Contact U Pull Auto Parts Pocatello with the VIN and stock number to confirm availability.",
    });
    const { card, email, discord } = await renderSurfaces(restored);
    for (const html of [card, email]) {
      expect(html).toContain("public app hides vehicle search");
      expect(html).toContain("confirm availability");
      expect(html).not.toContain(href);
      expect(html).not.toContain("Search provider inventory");
    }
    expect(discord.url).toBeUndefined();
    expect(discord.description).toContain("public app hides vehicle search");
    expect(discord.description).not.toContain(href);
  });
  test("Discord encodes link delimiters without double-encoding existing URL filters", () => {
    const href =
      "https://trusted.example/a) [Injected](https://evil.example?filter%5Byard%5D=STOCKTON";
    const embed = formatVehicleEmbed(vehicle("pyp", href));
    expect(embed.description?.match(/\]\(/g)).toHaveLength(1);
    expect(embed.description).toContain("%29%20%5BInjected%5D%28");
    expect(embed.description).toContain("filter%5Byard%5D=STOCKTON");
    expect(embed.description).not.toContain("%255B");
  });
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

test.each([
  "waco",
  "bryan-college-station",
  "beaumont",
  "baton-rouge",
  "jackson-ms",
])("BYOT %s preserves its yard-specific native search destination", (slug) => {
  const href = `https://www.byotautoparts.com/locations/${slug}/inventory/`;
  expect(
    VehicleDestination.resolve({ source: "byot", detailsUrl: href }),
  ).toMatchObject({
    kind: "manual-search",
    href,
    label: "Search provider inventory",
  });
});
