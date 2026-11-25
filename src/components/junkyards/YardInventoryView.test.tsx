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
    // Checked just now, so the yard is current and shows its new arrivals;
    // a stale one shows none (see the staleness tests).
    checkedAt: new Date().toISOString(),
    checkUnknown: false,
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

describe("YardInventoryView pages", () => {
  test("a make's pages link within the make", async () => {
    const vehicles = Array.from({ length: 3 }, (_, index) =>
      vehicle(`VIN0000${index}`, "2026-10-01T00:00:00.000Z"),
    );
    const html = await render({
      ...props(vehicles),
      inventory: { page: 1, pageCount: 3, firstIndex: 0, vehicles },
      total: 250,
      filter: { name: "Honda", slug: "honda" },
    });
    expect(html).toContain(`href="${yard.path.href}/make/honda/page/2"`);
    expect(html).toContain(`href="${yard.path.href}/make/honda/page/3"`);
    expect(html).not.toContain(`href="${yard.path.href}/page/2"`);
  });
});

describe("YardInventoryView staleness", () => {
  const vehicles = [vehicle("VIN00001", "2026-11-01T00:00:00.000Z")];
  const daysAgo = (days: number) =>
    new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  test("says on the yard and on each vehicle when inventory older than 36 hours was last checked", async () => {
    const html = text(
      await render({
        ...props(vehicles),
        publishedAt: daysAgo(3),
        checkedAt: daysAgo(3),
      }),
    );
    expect(html.match(/Last checked 3 days ago/g)?.length).toBe(2);
  });

  test("shows no New badges or new-this-week count next to Last checked, since its newest cars are only new as of that check", async () => {
    const html = await render({
      ...props([
        vehicle("VIN00001", "2026-11-18T00:00:00.000Z"),
        vehicle("VIN00004", "2026-10-01T00:00:00.000Z"),
      ]),
      publishedAt: daysAgo(3),
      checkedAt: daysAgo(3),
    });
    expect(text(html)).toContain("Last checked 3 days ago");
    expect(text(html)).not.toContain("new this week");
    expect(badges(html)).toBe(0);
  });

  test("uses the source's date for a yard without its own, so an untracked yard of a stale source still says it", async () => {
    const html = text(
      await render({
        ...props(vehicles),
        publishedAt: null,
        checkedAt: daysAgo(13),
      }),
    );
    expect(html).toContain("Last checked 13 days ago");
    expect(html).not.toContain("Update time unknown");
  });

  test("says Last check unknown, with no New badges, for a yard no run has proven fetched", async () => {
    const html = await render({
      ...props([vehicle("VIN00001", "2026-11-18T00:00:00.000Z")]),
      publishedAt: null,
      checkedAt: null,
      checkUnknown: true,
    });
    expect(text(html)).toContain("Last check unknown");
    expect(text(html)).not.toContain("new this week");
    expect(badges(html)).toBe(0);
  });

  test("labels nothing while current", async () => {
    const html = text(
      await render({
        ...props(vehicles),
        publishedAt: null,
        checkedAt: daysAgo(1),
      }),
    );
    expect(html).not.toContain("Last checked");
    expect(html).toContain("Update time unknown");
  });
});
