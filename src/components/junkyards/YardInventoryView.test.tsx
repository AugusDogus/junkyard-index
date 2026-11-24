import { describe, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { HiddenSources } from "~/lib/hidden-source";
import { getYardDetails } from "~/lib/yard-details";
import { YardInventory, type YardVehicle } from "~/lib/yard-inventory";
import type { RoutedYard } from "~/server/yard-inventory";
import type { YardInventoryView } from "./YardInventoryView";

type Props = ComponentProps<typeof YardInventoryView>;

const VIEW = new URL("./YardInventoryView.tsx", import.meta.url).pathname;

// The view reads ~/env, so it renders in its own process with env mocked,
// keeping the mock out of other test files in the same Bun shard.
async function render(props: Props): Promise<string> {
  const { makeSlugs, ...rest } = props;
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
    import { mock } from "bun:test";
    mock.module("~/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://example.test" } }));
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { YardInventoryView } = await import(${JSON.stringify(VIEW)});
    const props = JSON.parse(process.env.YARD_VIEW_PROPS);
    process.stdout.write(renderToStaticMarkup(createElement(YardInventoryView, { ...props, makeSlugs: new Map(props.makeSlugs) })));
  `,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        YARD_VIEW_PROPS: JSON.stringify({
          ...rest,
          makeSlugs: [...makeSlugs],
        }),
      },
    },
  );
  const [output, errors, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(errors).toBe("");
  expect(exitCode).toBe(0);
  return output;
}

const inventory = {
  source: "pyp",
  code: "1196",
  name: "Pick Your Part - West Palm Beach",
  city: "West Palm Beach",
  state: "FL",
  lat: 26.69,
  lng: -80.17,
  inventoryUrl: null,
};

const yard: RoutedYard = {
  ...inventory,
  vehicleCount: 4,
  ...getYardDetails(inventory, null),
  path: {
    region: { abbr: "FL", name: "Florida", slug: "florida", country: "US" },
    slug: "pick-your-part-west-palm-beach",
    href: "/junkyards/florida/pick-your-part-west-palm-beach",
  },
};

const vehicle = (vin: string, addedAt: string): YardVehicle => ({
  vin,
  year: 2004,
  make: "Honda",
  model: "Civic",
  trim: null,
  engine: null,
  color: null,
  stockNumber: null,
  section: null,
  row: null,
  space: null,
  addedAt: Date.parse(addedAt),
  addedBy: "yard",
  imageUrl: null,
  detailsUrl: null,
});

// The snapshot published a week and a half before this render, so its week
// and the render's week hold different arrivals.
const publishedAt = "2026-11-08T12:00:00.000Z";
const renderedAt = "2026-11-19T12:00:00.000Z";

function props(vehicles: YardVehicle[]): Props {
  const page = YardInventory.page(YardInventory.sort(vehicles), 1);
  if (page === null) throw new Error("Fixture yard has no first page.");
  return {
    yard,
    inventory: page,
    total: vehicles.length,
    newArrivals: YardInventory.newArrivals(vehicles, vehicles, renderedAt),
    makes: YardInventory.makeCounts(vehicles),
    makeSlugs: new Map([["honda", "honda"]]),
    publishedAt,
    staleAfterMs: 3 * 24 * 60 * 60 * 1000,
    nearby: [],
    chain: null,
    filter: null,
    hiddenSources: HiddenSources.none,
  };
}

const badges = (html: string) => html.match(/>New</g)?.length ?? 0;
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("YardInventoryView new arrivals", () => {
  test("row badges count the same week as the header", async () => {
    const html = await render(
      props([
        // New at render time only.
        vehicle("VIN00001", "2026-11-18T00:00:00.000Z"),
        // New at publication time only.
        vehicle("VIN00002", "2026-11-05T00:00:00.000Z"),
        vehicle("VIN00003", "2026-11-06T00:00:00.000Z"),
        vehicle("VIN00004", "2026-10-01T00:00:00.000Z"),
      ]),
    );
    expect(text(html)).toContain("1 new this week");
    expect(badges(html)).toBe(1);
  });

  test("says nothing when none of the shown vehicles are new", async () => {
    const html = await render(
      props([
        vehicle("VIN00002", "2026-11-05T00:00:00.000Z"),
        vehicle("VIN00003", "2026-11-06T00:00:00.000Z"),
        vehicle("VIN00004", "2026-10-01T00:00:00.000Z"),
      ]),
    );
    expect(text(html)).not.toContain("new this week");
    expect(badges(html)).toBe(0);
  });
});
