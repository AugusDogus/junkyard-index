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
    globalThis.setRows = (count, make) => {
      rows = Array.from({ length: count }, (_, index) => ({
        vin: "VIN" + String(index).padStart(6, "0"),
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
    const summary = { total: 4500, makes: [], arrivals: [] };
    const page = await inventory.getYardVehiclePage(yard, summary, { kind: "yard" }, 21);
    console.log(JSON.stringify({ total: page.summary.total, first: page.data.firstIndex, count: page.data.vehicles.length, reads }));
  `),
  ).toEqual({ total: 4500, first: 2000, count: 100, reads: 1 });
});

test("a slice from a newer read than the summary renders from a fresh read", () => {
  expect(
    run(`
    // The summary was cached when the yard had 2,050 vehicles; it has 1,990
    // now, and the slices are not cached yet.
    setRows(1990, () => "HONDA");
    const stale = { total: 2050, makes: [{ key: "HONDA", make: "Honda", count: 2050 }], arrivals: [] };
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
