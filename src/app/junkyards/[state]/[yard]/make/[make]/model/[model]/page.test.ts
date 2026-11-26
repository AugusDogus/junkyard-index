import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

type Opened = {
  config: { dynamic: unknown; revalidate: unknown; params: unknown };
  outcome:
    | { redirect: string }
    | { notFound: true }
    | { vehicles: number; total: number };
  metadata: unknown;
  makeReads: number;
  modelLookups: number;
  cdnTags: string[];
};

const routeFile = fileURLToPath(new URL("./page.tsx", import.meta.url));

/**
 * Opens /junkyards/tx/{yard}/make/{make}/model/{model} with 3 Silverados
 * and 2 Tahoes at Calton. Runs in its own process so the module mocks stay
 * out of other test files.
 */
async function open(
  make: string,
  model: string,
  yard = "calton",
): Promise<Opened> {
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
      yardMakeMetadata: (yard, make, total) => ({ make: make.slug, model: make.model.slug, total }),
    }));
    mock.module("~/server/source-control/hidden-sources-loader", () => ({
      getHiddenSources: async () => ({ list: [] }),
      SOURCE_CONTROL_CACHE_TAG: "source-control",
    }));
    globalThis.cdnTags = new Set();
    mock.module("@vercel/functions", () => ({
      addCacheTag: async (tag) => { globalThis.cdnTags.add(tag); },
    }));
    const chevrolet = { key: "CHEVROLET", name: "Chevrolet", slug: "chevrolet", rawMakes: ["Chevrolet"] };
    const { VehicleName } = await import("~/lib/vehicle-name");
    const models = ["Silverado", "Tahoe"].map((name) => ({
      key: VehicleName.modelKey("Chevrolet", name),
      name,
      slug: name.toLowerCase(),
      rawModels: [name],
    }));
    globalThis.modelLookups = 0;
    mock.module("~/server/vehicle-models", () => ({
      getYardModelPageData: async (makeSlug, modelSlug) => {
        globalThis.modelLookups++;
        if (makeSlug !== "chevrolet" && makeSlug !== "chevy") return null;
        const model = models.find((candidate) => candidate.slug === modelSlug);
        return model ? { make: chevrolet, model } : null;
      },
      getMakeSlugs: async () => new Map([["CHEVROLET", "chevrolet"]]),
    }));
    const { YardInventory } = await import("~/lib/yard-inventory");
    const vehicles = ["Silverado", "Silverado", "Silverado", "Tahoe", "Tahoe"].map((model, index) => ({
      vin: "VIN" + index, year: 2004, make: "Chevrolet", model,
      trim: null, engine: null, color: null, stockNumber: null, section: null,
      row: null, space: null, addedAt: index, addedBy: "first-seen",
      imageUrl: null, detailsUrl: null,
    }));
    const summary = YardInventory.summary(vehicles, vehicles.map((vehicle) => vehicle.make));
    const path = { region: { slug: "tx" }, slug: "calton", href: "/junkyards/tx/calton" };
    globalThis.makeReads = 0;
    mock.module("~/server/yard-inventory", () => ({
      getYardPageData: async (state, yard) =>
        state === "tx" && yard === "calton"
          ? { yard: { source: "pyp", code: "1", path }, summary, publishedAt: null, nearby: [], chain: null }
          : null,
      // The page reads only its model's cached list, never the whole yard.
      getYardModelVehicles: async (yard, cached, makeKey, model) => {
        globalThis.makeReads++;
        return makeKey === "CHEVROLET"
          ? YardInventory.forModel(vehicles, makeKey, model.key)
          : [];
      },
    }));
    const route = await import(process.argv[3]);
    const params = Promise.resolve({ state: "tx", yard: process.argv[4], make: process.argv[1], model: process.argv[2] });
    let outcome;
    try {
      const element = await route.default({ params });
      const view = element.props.children.props;
      outcome = { vehicles: view.inventory.vehicles.length, total: view.total };
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      outcome = error.message === "not-found"
        ? { notFound: true }
        : { redirect: error.message.replace(/^redirect:/, "") };
    }
    const metadata = await route.generateMetadata({ params });
    process.stdout.write(JSON.stringify({
      config: {
        dynamic: route.dynamic ?? null,
        revalidate: route.revalidate ?? null,
        params: typeof route.generateStaticParams,
      },
      outcome,
      metadata,
      makeReads: globalThis.makeReads,
      modelLookups: globalThis.modelLookups,
      cdnTags: [...globalThis.cdnTags].sort(),
    }));
  `,
      make,
      model,
      routeFile,
      yard,
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
  const parsed: Opened = JSON.parse(output);
  return parsed;
}

describe("yard model page", () => {
  test("renders on request, never as a stored ISR page", async () => {
    expect((await open("chevrolet", "silverado")).config).toEqual({
      dynamic: "force-dynamic",
      revalidate: null,
      params: "undefined",
    });
  });

  test("lists the model's vehicles from the model's list, with its metadata", async () => {
    const opened = await open("chevrolet", "silverado");
    expect(opened.outcome).toEqual({ vehicles: 3, total: 3 });
    expect(opened.metadata).toEqual({
      make: "chevrolet",
      model: "silverado",
      total: 3,
    });
    expect(opened.makeReads).toBeGreaterThan(0);
  });

  test("sends a make alias to the canonical model URL", async () => {
    expect((await open("chevy", "tahoe")).outcome).toEqual({
      redirect: "/junkyards/tx/calton/make/chevrolet/model/tahoe",
    });
  });

  test("answers 404 for an unknown make or model, with no metadata", async () => {
    for (const [make, model] of [
      ["zzz", "silverado"],
      ["chevrolet", "zzz"],
    ] as const) {
      expect(await open(make, model)).toMatchObject({
        outcome: { notFound: true },
        metadata: {},
      });
    }
  });

  test("tags its CDN copy with the tags that expire when the yard's inventory or the hidden sources change", async () => {
    // daily-inventory: the yard's context (nearby yards, dates, staleness
    // labels, hidden sources) changes at every publication without its
    // vehicles changing.
    const yardTags = [
      "daily-inventory",
      "inventory-source:pyp",
      "inventory-sources",
      "inventory-yard:pyp:1",
      "source-control",
    ];
    expect((await open("chevrolet", "silverado")).cdnTags).toEqual(yardTags);
    expect((await open("chevy", "tahoe")).cdnTags).toEqual(yardTags);
    // A 404 for a model the yard lacks clears when the yard's stock changes.
    expect((await open("chevrolet", "zzz")).cdnTags).toEqual(yardTags);
    // A 404 for an unknown yard clears at the next publication, which can
    // add the yard.
    expect((await open("chevrolet", "silverado", "nowhere")).cdnTags).toEqual([
      "daily-inventory",
      "inventory-sources",
      "source-control",
    ]);
  });

  test("looks up no make or model for an unknown yard, so junk URLs cache nothing", async () => {
    expect(await open("chevrolet", "silverado", "nowhere")).toMatchObject({
      outcome: { notFound: true },
      modelLookups: 0,
    });
  });
});
