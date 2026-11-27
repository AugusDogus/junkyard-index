import { beforeAll, expect, test } from "bun:test";
import { Effect } from "effect";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { UrgiisReplayArchive } from "./urgiis-replay-archive";
import { iisCards, iisDirectory } from "./urgiis-catalog";
import { streamUrgiisInventory } from "./urgiis-connector";
import { urgiisError } from "./urgiis-client";
import { ProviderTurnDeferred } from "./provider-chunk-clock";
import { UrgiisCursor } from "./urgiis-cursor";
import { URGIIS_DAY_MS as DAY } from "./urgiis-census";
import { urgiisYardChecks } from "./urgiis-publication";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import type { UrgiisControl, UrgiisRecord } from "./urgiis-schema";
import type { CanonicalVehicle } from "./types";

// Norb's backend gives up after about 17 seconds on its largest model pages
// and renders the model template's "No Results Found" while each car's detail
// page still answers. These runs use Norb's saved owner, arrivals and model
// pages; directories keep their saved controls for a few models.
const qualified = URGIIS_TENANTS.find((t) => t.code === "norbs");
if (!qualified) throw new Error("Missing Norb's qualification");
const tenant = { ...qualified, minimumInventory: 1 };
const tenants = [tenant];
const start = Date.UTC(2026, 10, 16, 7);
const store = IngestionSnapshotStore.memory();
const chosen = {
  CHEVROLET: ["CRUZE", "EQUINOX"],
  FORD: ["FIVE HUNDRED", "FLEX"],
} as const;
const pages = new Map<string, string>();
const makes: UrgiisControl[] = [];
const menus = new Map<string, UrgiisControl[]>();
const cars = new Map<string, UrgiisRecord>();
let equinox: { model: UrgiisControl; records: UrgiisRecord[] };
let baseline: Awaited<ReturnType<typeof run>>;

const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
const document = (body: string) =>
  `<html><head><title>Norb's Auto Salvage</title></head><body><script>var urgid = '${tenant.urgid}';</script><div id="iiscont">${body}</div></body></html>`;
const directory = (controls: UrgiisControl[], kind: "makes" | "menu") =>
  document(
    `<div ${kind === "makes" ? 'class="iisMakesMenu"' : 'id="menumodellist"'}>${controls.map((c) => `<a href="${escape(c.path)}">${escape(c.label)}<span class="badge">${c.count}</span></a>`).join("")}</div>`,
  );
/** Saved cards rendered as an arrivals or model page. */
const cards = (
  records: readonly UrgiisRecord[],
  title = "Norb's Auto Salvage",
) =>
  `<html><head><title>${escape(title)}</title></head><body><script>var urgid = '${tenant.urgid}';</script><div id="iiscont"><div class="card-deck">${records
    .map(
      (r) =>
        `<div class="card-price"><div class="card-img">${r.image ? `<img src="${escape(r.image)}">` : ""}</div><div class="car-details"><b>Stock:</b>${escape(r.stock ?? "")}<br><b>Year:</b>${escape(r.years[0] ?? "")}<br><b>Make/Model:</b>${escape(r.titles[0] ?? "")}<br><b>VIN:</b>${escape(r.vins[0] ?? "")}<br>${r.date ? `<b>Enter Date:</b>${escape(r.date)}<br>` : ""}${r.purchaseDate ? `<b>Purchase Date:</b>${escape(r.purchaseDate)}<br>` : ""}</div>${r.destinations.map((url) => `<a href="${escape(url)}">See Parts</a>`).join("")}${r.inquiries.map((claim) => `<button data-vehicle="${escape(claim)}">Inquire</button>`).join("")}</div>`,
    )
    .join("")}</div></div></body></html>`;
let arrivals: UrgiisRecord[] = [];
/** Norb's model template when its backend gives up. */
const timedOut = document(
  '<div class="alert alert-warning m-3 text-center" role="alert"><h3>No Results Found. Try Browsing Our Parts Or Search Again</h3></div>',
);
/** A car's detail page: one part row, or the native no-results message. */
const detail = (record: UrgiisRecord | undefined) =>
  record
    ? document(
        `<table><tr><td><ul><li class="iispartpagevin"><strong>VIN: </strong>${escape(record.vins[0] ?? "")}</li></ul></td><td><form class="carte"><input type="hidden" name="yearin" value="${escape(record.years[0] ?? "")}" /><input type="hidden" name="stockno" value="${escape(record.stock ?? "")}" /></form></td></tr></table>`,
      )
    : document(
        '<div class="cstm-error-page-unit"><h3 class="text-transform nothing found RRRRSSS">No Results.. Try Browsing Our Parts Or Search Again</h3></div>',
      );

interface Day {
  previous?: unknown;
  now?: number;
  /** Model paths whose page always times out into an explicit empty. */
  empty?: readonly string[];
  /** Model paths whose page always fails its request. */
  fail?: readonly string[];
  /** Fail only this many reads of each `fail` page. */
  failReads?: number;
  /** Failed reads report that their retry could not get a shared host turn. */
  retryDeferred?: boolean;
  /** Extra cards on the arrivals page. */
  arrive?: readonly UrgiisRecord[];
  /** Equinox's cards, when not the saved page. */
  equinoxCards?: readonly UrgiisRecord[];
  /** Stocks whose car has left: its detail page has no part rows. */
  gone?: readonly string[];
  /** Stocks whose detail page request always fails. */
  failDetail?: readonly string[];
  /** Live badge changes by model path. */
  badge?: Readonly<Record<string, number>>;
}
async function run(day: Day = {}) {
  let cursor = UrgiisCursor.initial(tenants);
  const reads: string[] = [];
  const vehicles: CanonicalVehicle[] = [];
  const warnings: string[] = [];
  for (let chunk = 0; cursor.phase !== "complete" && chunk < 400; chunk++) {
    const result = await Effect.runPromise(
      streamUrgiisInventory({
        tenants,
        startCursor: cursor,
        previousCursor: day.previous,
        now: day.now ?? start,
        loadCensus: async (path) => (await store.load(path)).checkpointState,
        maxPages: 3,
        readPage: (url) => {
          reads.push(url);
          const path = new URL(url).pathname;
          const fail = () =>
            Effect.fail({
              ...urgiisError("request/body " + url, "offline repeated HTTP500"),
              ...(day.retryDeferred && {
                retryDeferred: new ProviderTurnDeferred({
                  host: "URG IIS",
                  stage: "wait",
                  elapsedMs: 330_000,
                  queuedMs: 300_000,
                }),
              }),
            });
          if (
            day.fail?.includes(path) &&
            reads.filter((u) => u === url).length <= (day.failReads ?? Infinity)
          )
            return fail();
          if (path === tenant.arrivalsPath && day.arrive)
            return Effect.succeed(
              cards(
                [...arrivals, ...day.arrive],
                "Latest Arrivals - Norb's Auto Salvage",
              ),
            );
          if (path === tenant.makesPath)
            return Effect.succeed(directory(makes, "makes"));
          const menu = menus.get(path);
          if (menu)
            return Effect.succeed(
              directory(
                menu.map((m) => ({
                  ...m,
                  count: day.badge?.[m.path] ?? m.count,
                })),
                "menu",
              ),
            );
          if (day.empty?.includes(path)) return Effect.succeed(timedOut);
          if (path === equinox.model.path && day.equinoxCards)
            return Effect.succeed(cards(day.equinoxCards));
          const car = cars.get(url);
          if (car) {
            if (day.failDetail?.includes(car.stock ?? "")) return fail();
            return Effect.succeed(
              detail(day.gone?.includes(car.stock ?? "") ? undefined : car),
            );
          }
          const page = pages.get(url);
          return page
            ? Effect.succeed(page)
            : Effect.fail(urgiisError("fixture", "Unexpected request " + url));
        },
        onBatch: (batch) =>
          Effect.sync(() => {
            vehicles.push(...batch);
          }),
      }),
    );
    if (result.status === "failed") throw new Error(result.errors.join("; "));
    warnings.push(...result.warnings);
    let next = result.cursor;
    if (result.checkpointState) {
      const statePath = await store.put({
        runId: "offline",
        source: "urgiis",
        chunk: {
          vehicles: [],
          observedVins: [],
          checkpointState: result.checkpointState,
        },
      });
      next = UrgiisCursor.checkpoint({ ...next, statePath }, tenants);
    }
    cursor = UrgiisCursor.fromWire(
      UrgiisCursor.serialize(next, tenants),
      tenants,
    );
  }
  expect(cursor.phase).toBe("complete");
  const details = reads.filter((url) => cars.has(url));
  return { cursor, reads, details, vehicles, warnings };
}
const stocks = (vehicles: readonly CanonicalVehicle[]) =>
  vehicles.map((v) => v.stockNumber).sort();
const equinoxPath = () => equinox.model.path;
const equinoxUrl = () => tenant.origin + equinox.model.path;
/** An Equinox car that publishes, so its departure is visible. */
const departing = () => {
  const stock = baseline.vehicles.find((v) =>
    v.detailsUrl?.startsWith(equinoxUrl()),
  )?.stockNumber;
  if (!stock) throw new Error("Missing published Equinox donor");
  return stock;
};

beforeAll(async () => {
  const archive = await UrgiisReplayArchive.open("norbs");
  try {
    for (
      let response = await archive.next();
      response;
      response = await archive.next()
    )
      if (!pages.has(response.url)) pages.set(response.url, response.html);
  } finally {
    archive.close();
  }
  for (const make of iisDirectory(
    pages.get(tenant.origin + tenant.makesPath) ?? "",
    tenant,
  )) {
    const labels: readonly string[] =
      make.label === "CHEVROLET" || make.label === "FORD"
        ? chosen[make.label]
        : [];
    if (!labels.length) continue;
    const menu = iisDirectory(
      pages.get(tenant.origin + make.path) ?? "",
      tenant,
      make,
    ).filter((m) => labels.includes(m.label));
    makes.push(make);
    menus.set(make.path, menu);
    for (const model of menu) {
      const records = iisCards(
        pages.get(tenant.origin + model.path) ?? "",
        tenant,
      ).records;
      for (const record of records)
        for (const url of record.destinations) cars.set(url, record);
      if (model.label === "EQUINOX") equinox = { model, records };
    }
  }
  arrivals = iisCards(
    pages.get(tenant.origin + (tenant.arrivalsPath ?? "")) ?? "",
    tenant,
    "arrivals",
  ).records;
  expect(makes).toHaveLength(2);
  expect(equinox.records.length).toBeGreaterThan(100);
  baseline = await run();
  expect(baseline.cursor.completed[0]).toHaveProperty("accepted");
  expect(baseline.details).toEqual([]);
});

test("a model empty after its later retry with evidence too old to defer is rechecked car by car and its yard is fetched", async () => {
  // November 30, 2026: Norb's largest pages had failed since the 24th, so
  // their evidence reached the six-day carry limit and the whole tenant
  // would have blocked.
  const gone = departing();
  const result = await run({
    previous: baseline.cursor,
    now: start + 6 * DAY,
    empty: [equinoxPath()],
    gone: [gone],
    badge: { [equinoxPath()]: equinox.model.count - 1 },
  });
  expect(result.cursor.completed).toEqual([
    { code: tenant.code, accepted: baseline.vehicles.length - 1 },
  ]);
  expect(urgiisYardChecks(result.cursor)).toEqual([
    { locationCode: tenant.yard.code, outcome: "fetched" },
  ]);
  expect(stocks(result.vehicles)).toEqual(
    stocks(baseline.vehicles.filter((v) => v.stockNumber !== gone)),
  );
  expect(result.reads.filter((url) => url === equinoxUrl())).toHaveLength(2);
  expect(new Set(result.details).size).toBe(result.details.length);
  expect(result.details).toHaveLength(equinox.records.length);
  expect(result.warnings.join(" ")).toContain(
    `${equinox.records.length - 1} still listed, 1 gone`,
  );
});

test("a failed model with young evidence is rechecked instead of replaying its listings", async () => {
  const gone = departing();
  const result = await run({
    previous: baseline.cursor,
    now: start + DAY,
    fail: [equinoxPath()],
    gone: [gone],
    badge: { [equinoxPath()]: equinox.model.count - 1 },
  });
  expect(urgiisYardChecks(result.cursor)).toEqual([
    { locationCode: tenant.yard.code, outcome: "fetched" },
  ]);
  expect(result.vehicles.map((v) => v.stockNumber)).not.toContain(gone);
  expect(result.details).toHaveLength(equinox.records.length);
  // The revalidated evidence carries the next day like a read.
  const next = await run({
    previous: result.cursor,
    now: start + 2 * DAY,
    badge: { [equinoxPath()]: equinox.model.count - 1 },
  });
  expect(next.reads).not.toContain(equinoxUrl());
  expect(next.details).toEqual([]);
  expect(stocks(next.vehicles)).toEqual(stocks(result.vehicles));
});

test("a detail page that keeps failing falls back to deferring young evidence and blocking old evidence", async () => {
  const stuck = equinox.records[3]?.stock;
  if (!stuck) throw new Error("Missing Equinox stock");
  const young = await run({
    previous: baseline.cursor,
    now: start + DAY,
    fail: [equinoxPath()],
    failDetail: [stuck],
    badge: { [equinoxPath()]: equinox.model.count + 1 },
  });
  expect(urgiisYardChecks(young.cursor)).toEqual([
    { locationCode: tenant.yard.code, outcome: "replayed" },
  ]);
  expect(stocks(young.vehicles)).toEqual(stocks(baseline.vehicles));
  // The three cars before it, then three chunk attempts at the stuck page;
  // no car after it is requested.
  expect(young.details).toHaveLength(3 + 3);
  const warning = young.warnings.find((w) => w.includes("retaining donors"));
  expect(warning).toContain("offline repeated HTTP500");
  expect(warning).toContain(`${stuck}/`);
  const old = await run({
    previous: baseline.cursor,
    now: start + 6 * DAY,
    empty: [equinoxPath()],
    failDetail: [stuck],
  });
  expect(old.details.length).toBeGreaterThan(0);
  expect(old.vehicles).toEqual([]);
  expect(old.cursor.completed).toEqual([
    {
      code: tenant.code,
      blocked: expect.stringContaining(
        "no eligible prior model evidence can be carried",
      ),
    },
  ]);
});

test("rechecked cars that fall short of the live badge are not published as fresh", async () => {
  // A failed read can look like a gone car, and a car entered outside the
  // arrivals window is unseen; the live badge bounds both.
  const result = await run({
    previous: baseline.cursor,
    now: start + DAY,
    fail: [equinoxPath()],
    badge: { [equinoxPath()]: equinox.model.count + 10 },
  });
  expect(result.details).toHaveLength(equinox.records.length);
  expect(urgiisYardChecks(result.cursor)).toEqual([
    { locationCode: tenant.yard.code, outcome: "replayed" },
  ]);
  expect(result.warnings.join(" ")).toContain(
    `live badge advertises ${equinox.model.count + 10}`,
  );
});

test("models that read or carry request no detail pages", async () => {
  const unchanged = await run({ previous: baseline.cursor, now: start + DAY });
  const read = await run({
    previous: baseline.cursor,
    now: start + DAY,
    badge: { [equinoxPath()]: equinox.model.count + 1 },
  });
  expect(read.reads).toContain(equinoxUrl());
  for (const day of [unchanged, read]) {
    expect(day.details).toEqual([]);
    expect(urgiisYardChecks(day.cursor)).toEqual([
      { locationCode: tenant.yard.code, outcome: "fetched" },
    ]);
  }
});

test("a cold census never rechecks a failed model", async () => {
  const result = await run({ empty: [equinoxPath()] });
  expect(result.details).toEqual([]);
  expect(result.cursor.completed[0]).toHaveProperty("blocked");
});

test("a detail retry that cannot get a shared host turn counts as an attempt", async () => {
  // Under 07:00 contention the recheck must still reach its fallback instead
  // of deferring every chunk onto the same car.
  const stuck = equinox.records[3]?.stock;
  if (!stuck) throw new Error("Missing Equinox stock");
  const result = await run({
    previous: baseline.cursor,
    now: start + DAY,
    fail: [equinoxPath()],
    failDetail: [stuck],
    retryDeferred: true,
    badge: { [equinoxPath()]: equinox.model.count + 1 },
  });
  expect(result.details).toHaveLength(3 + 3);
  expect(urgiisYardChecks(result.cursor)).toEqual([
    { locationCode: tenant.yard.code, outcome: "replayed" },
  ]);
});

test("a model with evidence too old to defer gets its chunk rereads before a recheck", async () => {
  const recovers = await run({
    previous: baseline.cursor,
    now: start + 6 * DAY,
    fail: [equinoxPath()],
    failReads: 1,
  });
  expect(recovers.reads.filter((url) => url === equinoxUrl())).toHaveLength(2);
  expect(recovers.details).toEqual([]);
  expect(stocks(recovers.vehicles)).toEqual(stocks(baseline.vehicles));
  // A deferred retry counts too, so contention cannot hold the chunk on it.
  const contended = await run({
    previous: baseline.cursor,
    now: start + 6 * DAY,
    fail: [equinoxPath()],
    retryDeferred: true,
  });
  expect(contended.reads.filter((url) => url === equinoxUrl())).toHaveLength(3);
  expect(contended.details).toHaveLength(equinox.records.length);
  expect(urgiisYardChecks(contended.cursor)).toEqual([
    { locationCode: tenant.yard.code, outcome: "fetched" },
  ]);
});

test("a rechecked model keeps its new arrivals after they leave the arrivals window", async () => {
  const [arrival, ...rest] = equinox.records.filter((r) =>
    baseline.vehicles.some((v) => v.stockNumber === r.stock),
  );
  if (!arrival) throw new Error("Missing published Equinox donor");
  const others = equinox.records.filter((r) => r !== arrival);
  expect(rest.length).toBeGreaterThan(0);
  const before = await run({ equinoxCards: others });
  expect(before.vehicles.map((v) => v.stockNumber)).not.toContain(
    arrival.stock,
  );
  const arrived = await run({
    previous: before.cursor,
    now: start + DAY,
    fail: [equinoxPath()],
    arrive: [arrival],
    badge: { [equinoxPath()]: equinox.model.count },
  });
  expect(arrived.vehicles.map((v) => v.stockNumber)).toContain(arrival.stock);
  const later = await run({
    previous: arrived.cursor,
    now: start + 2 * DAY,
    fail: [equinoxPath()],
    badge: { [equinoxPath()]: equinox.model.count + 1 },
  });
  expect(later.details).toContain(arrival.destinations[0] ?? "");
  expect(later.vehicles.map((v) => v.stockNumber)).toContain(arrival.stock);
  expect(urgiisYardChecks(later.cursor)).toEqual([
    { locationCode: tenant.yard.code, outcome: "fetched" },
  ]);
});
