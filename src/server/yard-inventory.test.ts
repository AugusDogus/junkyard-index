import { expect, test } from "bun:test";

// Runs in its own process so the module mocks stay out of other test files.
// The cache mock keys entries by key parts and arguments, like unstable_cache.
function run(scenario: string): unknown {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
    import { mock } from "bun:test";
    const entries = new Map();
    mock.module("server-only", () => ({}));
    mock.module("next/cache", () => ({
      unstable_cache: (load, keyParts) => async (...args) => {
        const key = JSON.stringify([...keyParts, ...args]);
        if (!entries.has(key)) entries.set(key, await load(...args));
        return structuredClone(entries.get(key));
      },
    }));
    let rows = [];
    globalThis.setRows = (count, make, prefix = "VIN") => {
      rows = Array.from({ length: count }, (_, index) => ({
        vin: prefix + String(index).padStart(6, "0"),
        year: 2004, make: make(index), model: "Civic", sourceModel: null,
        trim: null, engine: null, color: null, stockNumber: null,
        section: null, row: null, space: null, availableDate: null,
        firstSeenAt: new Date(Date.UTC(2026, 0, 1) + index * 60000),
        observedArrivalAt: null, imageUrl: null, detailsUrl: null,
      }));
    };
    globalThis.reads = 0;
    mock.module("~/lib/db", () => ({
      db: { select: () => ({ from: () => ({ where: async () => { globalThis.reads++; return rows; } }) }) },
    }));
    const { YardInventory } = await import("./src/lib/yard-inventory.ts");
    // The summary a read of the current rows caches.
    globalThis.summaryOf = () =>
      YardInventory.summary(
        YardInventory.sort(
          rows.map(({ firstSeenAt, observedArrivalAt, ...row }) =>
            YardInventory.vehicle({ ...row, firstSeenAt: firstSeenAt.getTime(), observedArrivalAt: null }),
          ),
        ),
        rows.map((row) => row.make),
      );
    const inventory = await import("./src/server/yard-inventory.ts");
    const yard = { source: "pyp", code: "1" };
    ${scenario}
  `,
    ],
    { cwd: process.cwd(), env: { ...process.env, SKIP_ENV_VALIDATION: "1" } },
  );
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout.toString());
}

test("a yard page reads one cached slice and agrees with the summary", () => {
  expect(
    run(`
    setRows(4500, () => "HONDA");
    const summary = summaryOf();
    const page = await inventory.getYardVehiclePage(yard, summary, { kind: "yard" }, 21);
    console.log(JSON.stringify({ total: page.summary.total, first: page.data.firstIndex, count: page.data.vehicles.length, reads }));
  `),
  ).toEqual({ total: 4500, first: 2000, count: 100, reads: 1 });
});

test("a make page lists that make's vehicles from the cached slices", () => {
  expect(
    run(`
    setRows(4500, (index) => (index % 3 === 0 ? "FORD" : "HONDA"));
    const summary = summaryOf();
    const page = await inventory.getYardVehiclePage(yard, summary, { kind: "make", key: "FORD" }, 15);
    // Another make page of the yard reads only cached slices.
    const cachedReads = reads;
    const past = await inventory.getYardVehiclePage(yard, summary, { kind: "make", key: "FORD" }, 16);
    console.log(JSON.stringify({
      page: page.data.page,
      pageCount: page.data.pageCount,
      makes: [...new Set(page.data.vehicles.map((vehicle) => vehicle.make))],
      count: page.data.vehicles.length,
      past: past.data,
      newReads: reads - cachedReads,
    }));
  `),
  ).toEqual({
    page: 15,
    pageCount: 15,
    makes: ["Ford"],
    count: 100,
    past: null,
    newReads: 0,
  });
});

test("a slice from a newer read than the summary renders from a fresh read", () => {
  expect(
    run(`
    // The summary was cached when the yard had 2,050 vehicles; it has 1,990
    // now, and the slices are not cached yet.
    setRows(2050, () => "HONDA");
    const stale = summaryOf();
    setRows(1990, () => "HONDA");
    const page = await inventory.getYardVehiclePage(yard, stale, { kind: "yard" }, 21);
    const make = await inventory.getYardMakeVehicles(yard, stale, "HONDA");
    console.log(JSON.stringify({
      page21: page.data,
      total: page.summary.total,
      makeTotal: make.summary.total,
      makeVehicles: make.data.length,
    }));
  `),
  ).toEqual({
    page21: null,
    total: 1990,
    makeTotal: 1990,
    makeVehicles: 1990,
  });
});

test("a slice from a different read of the same size renders from a fresh read", () => {
  expect(
    run(`
    // As many vehicles left the yard as arrived, so only the rows tell.
    setRows(2050, () => "HONDA", "OLD");
    const stale = summaryOf();
    setRows(2050, () => "FORD", "NEW");
    const page = await inventory.getYardVehiclePage(yard, stale, { kind: "yard" }, 1);
    const make = await inventory.getYardVehiclePage(yard, stale, { kind: "make", key: "HONDA" }, 1);
    console.log(JSON.stringify({
      makes: page.summary.makes,
      firstVin: page.data.vehicles[0].vin.slice(0, 3),
      hondaTotal: make.summary.makes.find((entry) => entry.key === "HONDA")?.count ?? 0,
      hondas: make.data.vehicles.length,
    }));
  `),
  ).toEqual({
    makes: [{ key: "FORD", make: "Ford", count: 2050 }],
    firstVin: "NEW",
    hondaTotal: 0,
    hondas: 0,
  });
});
