import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

/**
 * Opens /junkyards/tx/calton whose cached summary counts 100 vehicles while
 * its slice came from a newer read of 120, so the page renders from a fresh
 * read. Runs in its own process so the module mocks stay out of other test
 * files.
 */
async function open(): Promise<{ total: number; metadata: unknown }> {
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
    import { mock } from "bun:test";
    mock.module("next/navigation", () => ({
      notFound: () => { throw new Error("not-found"); },
    }));
    mock.module("~/components/junkyards/PublicPageShell", () => ({ PublicPageShell: () => null }));
    mock.module("~/components/junkyards/YardInventoryView", () => ({
      YardInventoryView: () => null,
      yardPageMetadata: (yard, total, publishedAt, page) => ({ total, page }),
    }));
    mock.module("~/server/source-control/hidden-sources-loader", () => ({ getHiddenSources: async () => ({ list: [] }) }));
    mock.module("~/server/vehicle-models", () => ({ getMakeSlugs: async () => new Map() }));
    const { YardInventory } = await import("~/lib/yard-inventory");
    const vehicles = (count) => Array.from({ length: count }, (_, index) => ({
      vin: "VIN" + index, year: 2004, make: "Chevrolet", model: "Silverado",
      trim: null, engine: null, color: null, stockNumber: null, section: null,
      row: null, space: null, addedAt: index, addedBy: "first-seen",
      imageUrl: null, detailsUrl: null,
    }));
    const cached = YardInventory.summary(vehicles(100), vehicles(100).map((vehicle) => vehicle.make));
    const fresh = vehicles(120);
    const path = { region: { slug: "tx" }, slug: "calton", href: "/junkyards/tx/calton" };
    mock.module("~/server/yard-inventory", () => ({
      getYardPageData: async () => ({ yard: { source: "pyp", code: "1", path }, summary: cached, publishedAt: null, nearby: [], chain: null }),
      getYardVehiclePage: async (yard, summary, scope, page) => ({
        summary: YardInventory.summary(fresh, fresh.map((vehicle) => vehicle.make)),
        data: YardInventory.page(fresh, page),
      }),
    }));
    const route = await import(process.argv[1]);
    const params = Promise.resolve({ state: "tx", yard: "calton" });
    const element = await route.default({ params });
    const view = element.props.children.props;
    const metadata = await route.generateMetadata({ params });
    process.stdout.write(JSON.stringify({ total: view.total, metadata }));
  `,
      fileURLToPath(new URL("./page.tsx", import.meta.url)),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [output, errors, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(errors).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(output);
}

describe("yard page", () => {
  test("its metadata counts the same read the page lists", async () => {
    expect(await open()).toEqual({
      total: 120,
      metadata: { total: 120, page: 1 },
    });
  });
});
