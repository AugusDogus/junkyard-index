import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

type Outcome =
  | { redirect: string }
  | { notFound: true }
  | { page: number; pageCount: number; vehicles: number; total: number };

/**
 * Opens /junkyards/tx/calton/make/{make}/page/{page} with 150 Chevrolets at
 * the yard. Runs in its own process so the module mocks stay out of other
 * test files.
 */
async function open(
  yard: string,
  make: string,
  page: string,
): Promise<{ outcome: Outcome; metadata: unknown }> {
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
    import { mock } from "bun:test";
    mock.module("next/navigation", () => ({
      notFound: () => { throw new Error("not-found"); },
      permanentRedirect: (href) => { throw new Error("redirect:" + href); },
    }));
    mock.module("~/components/junkyards/PublicPageShell", () => ({ PublicPageShell: () => null }));
    mock.module("~/components/junkyards/YardInventoryView", () => ({
      YardInventoryView: () => null,
      yardMakeMetadata: (yard, make, total, publishedAt, page) => ({ make: make.slug, total, page }),
    }));
    mock.module("~/server/source-control/hidden-sources-loader", () => ({ getHiddenSources: async () => ({ list: [] }) }));
    const chevrolet = { key: "CHEVROLET", name: "Chevrolet", slug: "chevrolet" };
    mock.module("~/server/vehicle-models", () => ({
      findMake: async (slug) => (slug === "chevrolet" || slug === "chevy" ? chevrolet : null),
      getMakeSlugs: async () => new Map([["CHEVROLET", "chevrolet"]]),
    }));
    const { YardInventory } = await import("~/lib/yard-inventory");
    const vehicles = Array.from({ length: 150 }, (_, index) => ({
      vin: "VIN" + index, year: 2004, make: "Chevrolet", model: "Silverado",
      trim: null, engine: null, color: null, stockNumber: null, section: null,
      row: null, space: null, addedAt: index, addedBy: "first-seen",
      imageUrl: null, detailsUrl: null,
    }));
    const summary = YardInventory.summary(vehicles);
    const path = { region: { slug: "tx" }, slug: "calton", href: "/junkyards/tx/calton" };
    mock.module("~/server/yard-inventory", () => ({
      getYardPageData: async (state, yard) =>
        state === "tx" && yard === "calton"
          ? { yard: { source: "pyp", code: "1", path }, summary, publishedAt: null, nearby: [], chain: null }
          : null,
      getYardVehiclePage: async (yard, cached, scope, page) => ({
        summary: cached,
        data: YardInventory.page(vehicles.filter((vehicle) => scope.kind === "yard" || scope.key === "CHEVROLET"), page),
      }),
    }));
    const route = await import(${JSON.stringify(fileURLToPath(new URL("./page.tsx", import.meta.url)))});
    const params = Promise.resolve({ state: "tx", yard: process.argv[1], make: process.argv[2], page: process.argv[3] });
    let outcome;
    try {
      const element = await route.default({ params });
      const view = (await element.type(element.props)).props.children.props;
      outcome = { page: view.inventory.page, pageCount: view.inventory.pageCount, vehicles: view.inventory.vehicles.length, total: view.total };
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      outcome = error.message === "not-found"
        ? { notFound: true }
        : { redirect: error.message.replace(/^redirect:/, "") };
    }
    const metadata = await route.generateMetadata({ params });
    process.stdout.write(JSON.stringify({ outcome, metadata }));
  `,
      yard,
      make,
      page,
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

describe("yard make page N", () => {
  test("lists the second page of a make with its paged metadata", async () => {
    expect(await open("calton", "chevrolet", "2")).toEqual({
      outcome: { page: 2, pageCount: 2, vehicles: 50, total: 150 },
      metadata: { make: "chevrolet", total: 150, page: 2 },
    });
  });

  test("sends an alias to the make's own slug on the same page", async () => {
    const { outcome } = await open("calton", "chevy", "2");
    expect(outcome).toEqual({
      redirect: "/junkyards/tx/calton/make/chevrolet/page/2",
    });
  });

  test("sends page 1 of an alias to the canonical make URL in one redirect", async () => {
    for (const make of ["chevy", "chevrolet"]) {
      const { outcome } = await open("calton", make, "1");
      expect(outcome).toEqual({
        redirect: "/junkyards/tx/calton/make/chevrolet",
      });
    }
  });

  test("answers 404 without a redirect for an unknown yard or make", async () => {
    for (const [yard, make] of [
      ["nowhere", "chevy"],
      ["calton", "zzz"],
    ] as const) {
      expect((await open(yard, make, "1")).outcome).toEqual({
        notFound: true,
      });
    }
  });

  test("answers 404 past the last page and for a malformed page", async () => {
    for (const page of ["3", "01", "two"]) {
      expect(await open("calton", "chevrolet", page)).toEqual({
        outcome: { notFound: true },
        metadata: {},
      });
    }
  });
});
