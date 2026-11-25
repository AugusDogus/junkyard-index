import { urgiisBrokenModelRoute } from "./urgiis-model-coverage";
import { beforeAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { UrgiisReplayArchive } from "./urgiis-replay-archive";
import { iisCards, iisDirectory } from "./urgiis-catalog";
import { urgiisSnapshot, validateUrgiisSnapshot } from "./urgiis-snapshot";
import { streamUrgiisInventory } from "./urgiis-connector";
import { urgiisError } from "./urgiis-client";
import {
  ProviderChunkClock,
  ProviderTurnDeferred,
} from "./provider-chunk-clock";
import { UrgiisCursor, URGIIS_MAX_CURSOR_BYTES } from "./urgiis-cursor";
import {
  URGIIS_DAY_MS as DAY,
  URGIIS_MODEL_FAILURE_STREAK,
  UrgiisCensus,
} from "./urgiis-census";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import type { UrgiisControl, UrgiisRecord } from "./urgiis-schema";
import type { CanonicalVehicle } from "./types";

const qualified = URGIIS_TENANTS.find((t) => t.code === "eagle");
if (!qualified) throw new Error("Missing Eagle qualification");
const tenant = { ...qualified, minimumInventory: 1, requestTimeoutMs: 90_000 };
const tenants = [tenant];
// Enough saved models to fail a whole streak with one more left over.
const fixtureModels = URGIIS_MODEL_FAILURE_STREAK + 2;
const store = IngestionSnapshotStore.memory();
const start = Date.UTC(2026, 10, 16);
const models: {
  make: UrgiisControl;
  model: UrgiisControl;
  raw: string;
  records: UrgiisRecord[];
}[] = [];
let owner = "";
let baseline: Awaited<ReturnType<typeof run>>;
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
const document = (body: string) =>
  `<html><head><title>Recent Arrivals</title></head><body><script>var urgid = '${tenant.urgid}';</script><div id="iiscont">${body}</div></body></html>`;
const empty = document(
  "No Results Found. Try Browsing Our Parts Or Search Again",
);
const directory = (controls: UrgiisControl[], kind: "makes" | "menu") =>
  document(
    `<div ${kind === "makes" ? 'class="iisMakesMenu"' : 'id="menumodellist"'}>${controls.map((c) => `<a href="${escape(c.path)}">${escape(c.label)}<span class="badge">${c.count}</span></a>`).join("")}</div>`,
  );
// Only changed-day responses are rendered. Native identities and claims come
// from saved Eagle cards; all baseline model responses are the original HTML.
const cards = (records: UrgiisRecord[]) =>
  records.length
    ? document(
        `<div class="card-deck">${records
          .map(
            (r) =>
              `<div class="card-price"><div class="card-img">${r.image ? `<img src="${escape(r.image)}">` : ""}</div><div class="car-details"><b>Stock:</b>${escape(r.stock ?? "")}<br><b>Year:</b>${escape(r.years[0] ?? "")}<br><b>Make/Model:</b>${escape(r.titles[0] ?? "")}<br><b>VIN:</b>${escape(r.vins[0] ?? "")}<br>${r.date ? `<b>Enter Date:</b>${escape(r.date)}<br>` : ""}${r.purchaseDate ? `<b>Purchase Date:</b>${escape(r.purchaseDate)}<br>` : ""}</div>${r.destinations.map((url) => `<a href="${escape(url)}">See Parts</a>`).join("")}${r.inquiries.map((claim) => `<button data-vehicle="${escape(claim)}">Inquire</button>`).join("")}</div>`,
          )
          .join("")}</div>`,
      )
    : empty;
const listed = (paths: string | readonly string[] | undefined, path: string) =>
  typeof paths === "string" ? paths === path : !!paths?.includes(path);
interface Day {
  previous?: unknown;
  emptyReads?: { path: string | readonly string[]; times: number };
  specialCount?: number;
  closingSpecialCount?: number;
  closingOrdinary?: string;
  tenantList?: typeof tenants;
  emptyTenant?: string;
  /** Limits `fail` to this tenant's reads. */
  failTenant?: string;
  now?: number;
  arrivals?: UrgiisRecord[];
  badge?: string | readonly string[];
  badgeCount?: number;
  replace?: { path: string; records: UrgiisRecord[] };
  fail?: string | readonly string[];
  /** Failed reads report that their retry could not get a shared host turn. */
  retryDeferred?: boolean;
  reads?: string[];
  maxPages?: number;
  clock?: (chunk: number) => number;
  drift?: string;
  malformed?: string;
  remove?: string;
}
async function run(day: Day = {}) {
  const now = day.now ?? start + 3600_000;
  const tenantList = day.tenantList ?? tenants;
  let cursor = UrgiisCursor.initial(tenantList);
  const reads = day.reads ?? [];
  const checkpoints: { pages: number; deferred: number }[] = [];
  const vehicles: CanonicalVehicle[] = [];
  const warnings: string[] = [];
  let peakCursorBytes = 0;
  const special = {
    path: "/parts/CHRYSLER/TOWN_-and_COUNTRY/",
    label: "Town & Country",
    count: day.specialCount ?? 0,
  };
  const first = models[0];
  if (!first) throw new Error("Missing first fixture model");
  const active = [
    ...models.filter((m) => m.model.path !== day.remove),
    ...(day.specialCount === undefined
      ? []
      : [
          {
            make: first.make,
            model: {
              ...special,
              path: first.make.path.replace(/\/$/, "") + "/TOWN_-and_COUNTRY/",
            },
            raw: empty,
            records: [],
          },
        ]),
  ];
  const makes = [...new Map(active.map((m) => [m.make.path, m.make])).values()];
  for (let chunks = 0; cursor.phase !== "complete" && chunks < 200; chunks++) {
    const result = await Effect.runPromise(
      streamUrgiisInventory({
        tenants: tenantList,
        startCursor: cursor,
        previousCursor: day.previous,
        now: day.clock?.(chunks) ?? now,
        loadCensus: async (path) => (await store.load(path)).checkpointState,
        maxPages: day.maxPages ?? 1,
        readPage: (url, currentTenant) => {
          reads.push(url);
          const path = new URL(url).pathname;
          if (
            (!day.failTenant || currentTenant.code === day.failTenant) &&
            (typeof day.fail === "string"
              ? path === day.fail
              : day.fail?.includes(path))
          )
            return Effect.fail({
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
          if (path === tenant.ownerPath) return Effect.succeed(owner);
          if (path === tenant.makesPath)
            return Effect.succeed(directory(makes, "makes"));
          if (path === tenant.arrivalsPath)
            return Effect.succeed(cards(day.arrivals ?? []));
          const make = makes.find((m) => m.path === path);
          if (make) {
            const controls = active
              .filter((m) => m.make.path === path)
              .map((m) => ({
                ...m.model,
                count:
                  m.model.path === day.closingOrdinary &&
                  reads.filter((u) => u === url).length > 1
                    ? 2
                    : m.model.label === "Town & Country" &&
                        day.closingSpecialCount !== undefined &&
                        reads.filter((u) => u === url).length > 1
                      ? day.closingSpecialCount
                      : listed(day.badge, m.model.path)
                        ? (day.badgeCount ?? m.model.count + 1)
                        : m.model.count +
                          (Array.isArray(day.fail) &&
                          day.fail.includes(m.model.path)
                            ? 1
                            : 0),
              }));
            if (day.drift === path && reads.filter((u) => u === url).length > 1)
              controls.reverse();
            return Effect.succeed(directory(controls, "menu"));
          }
          const model = active.find((m) => m.model.path === path);
          if (
            day.emptyReads &&
            listed(day.emptyReads.path, path) &&
            (!day.emptyTenant || currentTenant.code === day.emptyTenant) &&
            reads.filter((u) => u === url).length <= day.emptyReads.times
          )
            return Effect.succeed(empty);
          if (model)
            return Effect.succeed(
              day.malformed === path
                ? model.raw.replaceAll(tenant.urgid, "FOREIGN")
                : day.replace?.path === path
                  ? cards(day.replace.records)
                  : model.raw,
            );
          return Effect.fail(
            urgiisError("fixture", "Unexpected request " + url),
          );
        },
        onBatch: (batch) =>
          Effect.sync(() => {
            vehicles.push(...batch);
          }),
      }),
    );
    if (result.status === "failed") throw new Error(result.errors.join("; "));
    warnings.push(...result.warnings);
    checkpoints.push({
      pages: result.pagesProcessed,
      deferred:
        result.cursor.phase === "complete"
          ? 0
          : result.cursor.entries.filter(
              (e) => e.kind === "model" && e.freshness.kind === "deferred",
            ).length,
    });
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
      next = UrgiisCursor.checkpoint({ ...next, statePath }, tenantList);
    }
    const wire = UrgiisCursor.serialize(next, tenantList);
    peakCursorBytes = Math.max(
      peakCursorBytes,
      new TextEncoder().encode(wire).length,
    );
    cursor = UrgiisCursor.fromWire(wire, tenantList);
  }
  expect(cursor.phase).toBe("complete");
  return { cursor, reads, vehicles, warnings, peakCursorBytes, checkpoints };
}
/** A tenant failure ends only that tenant: it publishes nothing this run and
 * its earlier inventory stays published. */
async function expectBlocked(day: Day, reason: string) {
  const result = await run(day);
  expect(result.vehicles).toEqual([]);
  expect(result.cursor.completed).toEqual([
    { code: tenant.code, blocked: expect.stringContaining(reason) },
  ]);
  return result;
}
const readModels = (result: Awaited<ReturnType<typeof run>>) =>
  result.reads.filter((url) =>
    models.some((m) => tenant.origin + m.model.path === url),
  );
const target = () => {
  const model = models.find((m) => m.records.length > 1);
  if (!model) throw new Error("Missing multi-donor captured page");
  return model;
};
function knownArrival() {
  const record = models.find((m) => m.model.path !== target().model.path)
    ?.records[0];
  if (!record) throw new Error("Missing unrelated known arrival");
  return record;
}
beforeAll(async () => {
  const archive = await UrgiisReplayArchive.open("eagle");
  try {
    const responses = new Map<string, string>();
    for (
      let response = await archive.next();
      response;
      response = await archive.next()
    )
      if (!responses.has(response.url))
        responses.set(response.url, response.html);
    owner = responses.get(tenant.origin + tenant.ownerPath) ?? "";
    for (const make of iisDirectory(
      responses.get(tenant.origin + tenant.makesPath) ?? "",
      tenant,
    )) {
      const menu = iisDirectory(
        responses.get(tenant.origin + make.path) ?? "",
        tenant,
        make,
      );
      for (const model of menu) {
        const raw = responses.get(tenant.origin + model.path);
        if (!raw) continue;
        const records = iisCards(raw, tenant).records;
        const snapshot = urgiisSnapshot(
          [{ make, model, records, hash: "" }],
          tenant,
        );
        if (
          !snapshot.vehicles.length ||
          snapshot.accounting.recordsRejected ||
          snapshot.accounting.recordsExcluded
        )
          continue;
        validateUrgiisSnapshot(snapshot, tenant);
        models.push({ make, model, raw, records });
        if (models.length === fixtureModels) break;
      }
      if (models.length === fixtureModels) break;
    }
    expect(models).toHaveLength(fixtureModels);
    baseline = await run({ now: start });
  } finally {
    archive.close();
  }
});

test("first census reads every saved model; unchanged day reads only ownership, menus and arrivals", async () => {
  expect(readModels(baseline)).toHaveLength(models.length);
  const unchanged = await run({ previous: baseline.cursor });
  expect(readModels(unchanged)).toEqual([]);
  expect(unchanged.vehicles).toEqual(baseline.vehicles);
  expect(unchanged.peakCursorBytes).toBeLessThan(URGIIS_MAX_CURSOR_BYTES);
});
test("one changed badge rereads only its model", async () => {
  const path = target().model.path;
  const result = await run({ previous: baseline.cursor, badge: path });
  expect(readModels(result)).toEqual([tenant.origin + path]);
  expect(result.vehicles).toEqual(baseline.vehicles);
});
test("arrivals detect a new donor and a same-count replacement", async () => {
  const model = target();
  const [old, replacement] = model.records;
  if (!old || !replacement) throw new Error("Missing captured pair");
  const previous = await run({
    now: start,
    replace: { path: model.model.path, records: [old] },
  });
  const result = await run({
    previous: previous.cursor,
    arrivals: [replacement, knownArrival()],
    replace: { path: model.model.path, records: [replacement] },
  });
  expect(readModels(result)).toEqual([tenant.origin + model.model.path]);
  expect(result.vehicles.map((v) => v.vin)).toContain(
    replacement.vins[0] ?? "",
  );
  expect(result.vehicles.map((v) => v.vin)).not.toContain(old.vins[0]);
});
test("an unknown arrival adds to an unchanged-count model without losing known donors", async () => {
  const model = target();
  const [known, arrival] = model.records;
  if (!known || !arrival) throw new Error("Missing captured pair");
  const previous = await run({
    now: start,
    replace: { path: model.model.path, records: [known] },
  });
  const result = await run({
    previous: previous.cursor,
    arrivals: [arrival, knownArrival()],
  });
  expect(readModels(result)).toEqual([tenant.origin + model.model.path]);
  expect(result.vehicles.map((v) => v.vin)).toContain(known.vins[0] ?? "");
  expect(result.vehicles.map((v) => v.vin)).toContain(arrival.vins[0] ?? "");
});
test("rolling slices refresh every model within six days, reserving a day to publish", async () => {
  let previous = baseline.cursor;
  const swept: string[] = [];
  for (let day = 1; day <= 7; day++) {
    const result = await run({ previous, now: start + day * DAY });
    // Six slices: the slice day is also the day a model's carry expires.
    if (day < 6)
      expect(readModels(result)).toEqual(
        models
          .filter(
            (_, index) => index % 6 === (Math.floor(start / DAY) + day) % 6,
          )
          .map((m) => tenant.origin + m.model.path),
      );
    swept.push(...readModels(result));
    if (day === 6) expect(new Set(swept).size).toBe(models.length);
    previous = result.cursor;
  }
  expect(new Set(swept).size).toBe(models.length);
});
test("missing, corrupt, incompatible or missing-Blob history falls back to full census", async () => {
  const missing = UrgiisCursor.checkpoint(
    { ...baseline.cursor, statePath: "missing" },
    tenants,
  );
  for (const previous of [
    null,
    { ...baseline.cursor, checksum: "bad" },
    { ...baseline.cursor, version: 1 },
    missing,
  ]) {
    const result = await run({ previous });
    expect(readModels(result)).toHaveLength(models.length);
    expect(result.vehicles).toEqual(baseline.vehicles);
  }
  const badPath = await store.put({
    runId: "bad",
    source: "urgiis",
    chunk: {
      vehicles: [],
      observedVins: [],
      checkpointState: { version: 1, tenants: ["corrupt"] },
    },
  });
  expect(
    readModels(
      await run({
        previous: UrgiisCursor.checkpoint(
          { ...baseline.cursor, statePath: badPath },
          tenants,
        ),
      }),
    ),
  ).toHaveLength(models.length);
});
test("failed model carries its donors, persists a retry, and cannot reset the read age", async () => {
  const path = target().model.path;
  const failed = await run({
    previous: baseline.cursor,
    badge: path,
    fail: path,
  });
  expect(failed.vehicles).toEqual(baseline.vehicles);
  expect(readModels(failed)).toEqual([tenant.origin + path]);
  expect(failed.warnings.join(" ")).toContain("Retry next run");
  const retried = await run({
    previous: failed.cursor,
    badge: path,
    fail: path,
    now: start + 2 * 3600_000,
  });
  expect(readModels(retried)).toEqual([tenant.origin + path]);
  await expectBlocked(
    { previous: retried.cursor, fail: path, now: start + 7 * DAY },
    "offline repeated HTTP500",
  );
  const recovered = await run({ previous: failed.cursor, badge: path });
  expect(readModels(recovered)).toEqual([tenant.origin + path]);
});
test("a failed model whose retry could not get a shared host turn still carries its donors", async () => {
  // Under 07:00 contention a failing page's retries cannot all get turns in
  // one chunk. A model page must still reach its carry instead of deferring
  // the chunk onto the same page until the source gives up.
  const path = target().model.path;
  const failed = await run({
    previous: baseline.cursor,
    badge: path,
    fail: path,
    retryDeferred: true,
  });
  expect(failed.vehicles).toEqual(baseline.vehicles);
  expect(readModels(failed)).toEqual([tenant.origin + path]);
  expect(failed.warnings.join(" ")).toContain("Retry next run");
  // Any other page defers the chunk with its cursor unchanged.
  const deferral = await run({
    previous: baseline.cursor,
    fail: tenant.makesPath,
    retryDeferred: true,
  }).catch((error: unknown) => error);
  expect(ProviderChunkClock.deferralOf(deferral)).toBeInstanceOf(
    ProviderTurnDeferred,
  );
});
test("a failed model whose retry could not get a shared host turn defers the chunk when no donors can be carried", async () => {
  // Failing the chunk would spend a step retry on a transient error the
  // deferred retry never got to repeat.
  const path = target().model.path;
  for (const day of [
    // A cold census has no earlier model evidence.
    { fail: path },
    // The earlier evidence is too old to carry.
    { previous: baseline.cursor, fail: path, now: start + 8 * DAY },
  ]) {
    await expectBlocked(day, "offline repeated HTTP500");
    const deferral = await run({ ...day, retryDeferred: true }).catch(
      (error: unknown) => error,
    );
    expect(ProviderChunkClock.deferralOf(deferral)).toBeInstanceOf(
      ProviderTurnDeferred,
    );
  }
});
test("first-census page failures and parse/structural drift never use a carry", async () => {
  await expectBlocked(
    { fail: target().model.path },
    "offline repeated HTTP500",
  );
  const blocked = await run({
    previous: baseline.cursor,
    badge: target().model.path,
    malformed: target().model.path,
  });
  expect(blocked.vehicles).toEqual([]);
  expect(blocked.cursor.completed).toEqual([
    {
      code: tenant.code,
      blocked: expect.stringContaining("supplier identity changed"),
    },
  ]);
  expect(blocked.warnings).toEqual([
    expect.stringContaining("supplier identity changed"),
  ]);
  const make = models.find(
    (m) => models.filter((x) => x.make.path === m.make.path).length > 1,
  )?.make;
  if (!make) throw new Error("Missing multi-model captured menu");
  await expectBlocked(
    { previous: baseline.cursor, drift: make.path },
    "paths or labels changed",
  );
});
test("a disappeared control retires its donors only after closing confirms the graph", async () => {
  const removed = target();
  const result = await run({
    previous: baseline.cursor,
    remove: removed.model.path,
  });
  expect(readModels(result)).toEqual([]);
  expect(result.vehicles.length).toBe(
    baseline.vehicles.length - removed.records.length,
  );
  const state = UrgiisCensus.parse(
    (await store.load(result.cursor.statePath ?? "")).checkpointState,
    tenants,
    start + DAY,
  );
  expect(
    state.tenants[0]?.entries.some(
      (e) => e.url === tenant.origin + removed.model.path,
    ),
  ).toBe(false);
});

test("a newly published model is fully read before adding its donors", async () => {
  const path = target().model.path;
  const previous = await run({ now: start, remove: path });
  const result = await run({ previous: previous.cursor });
  expect(readModels(result)).toEqual([tenant.origin + path]);
  expect(result.vehicles).toEqual(baseline.vehicles);
});

test("carried donors still participate in full-snapshot admission and rejection guards", async () => {
  const donor = target().records[0];
  if (!donor) throw new Error("Missing captured donor");
  const rejected = {
    ...donor,
    stock: null,
    vins: [],
    inquiries: [],
    destinations: [],
  };
  await expectBlocked(
    {
      previous: baseline.cursor,
      arrivals: Array.from({ length: 100 }, () => rejected),
    },
    "admission",
  );
});

test("native arrival labels refresh a same-count model when its donor link uses another route", async () => {
  const model = target();
  const [old, replacement] = model.records;
  if (!old || !replacement) throw new Error("Missing captured pair");
  const previous = await run({
    now: start,
    badge: model.model.path,
    badgeCount: 1,
    replace: { path: model.model.path, records: [old] },
  });
  const arrival = {
    ...replacement,
    destinations: replacement.destinations.map((url) =>
      url.replace(model.model.path, model.model.path.replace(/\/$/, "_ALIAS/")),
    ),
  };
  const result = await run({
    previous: previous.cursor,
    badge: model.model.path,
    badgeCount: 1,
    arrivals: [arrival, knownArrival()],
    replace: { path: model.model.path, records: [] },
  });
  expect(readModels(result)).toEqual([tenant.origin + model.model.path]);
  expect(result.vehicles.map((v) => v.vin)).toContain(
    replacement.vins[0] ?? "",
  );
  expect(result.vehicles.map((v) => v.vin)).not.toContain(old.vins[0] ?? "");
});

test("an all-new arrivals window requires every model and cannot defer a failed page", async () => {
  const model = target();
  const [old, replacement] = model.records;
  if (!old || !replacement) throw new Error("Missing captured pair");
  const previous = await run({
    now: start,
    replace: { path: model.model.path, records: [old] },
  });
  const result = await run({
    previous: previous.cursor,
    arrivals: [replacement],
    replace: { path: model.model.path, records: [replacement] },
  });
  expect(readModels(result)).toHaveLength(models.length);
  expect(result.warnings.join(" ")).toContain("all-new");
  expect(result.vehicles.map((v) => v.vin)).toContain(
    replacement.vins[0] ?? "",
  );
  expect(result.vehicles.map((v) => v.vin)).not.toContain(old.vins[0] ?? "");
  await expectBlocked(
    {
      previous: previous.cursor,
      arrivals: [replacement],
      fail: models[0]?.model.path,
    },
    "offline repeated HTTP500",
  );
});

test("an oldest purchase date beyond the accepted run requires a full census even with known stocks", async () => {
  const record = knownArrival();
  const result = await run({
    previous: baseline.cursor,
    now: start + 2 * DAY,
    arrivals: [{ ...record, purchaseDate: "2026-11-17" }],
  });
  expect(readModels(result)).toHaveLength(models.length);
  expect(result.warnings.join(" ")).toContain("newer-oldest");
});

test("same-day replacement missing from arrivals stays stale only until that model's sweep", async () => {
  const model = target();
  const [old, replacement] = model.records;
  if (!old || !replacement) throw new Error("Missing captured pair");
  const previous = await run({
    now: start,
    replace: { path: model.model.path, records: [old] },
  });
  const replace = {
    path: model.model.path,
    records: [{ ...replacement, purchaseDate: "2000-01-01" }],
  };
  const missed = await run({
    previous: previous.cursor,
    replace,
    arrivals: [knownArrival()],
  });
  expect(readModels(missed)).toEqual([]);
  expect(missed.vehicles.map((v) => v.vin)).toContain(old.vins[0] ?? "");
  expect(missed.vehicles.map((v) => v.vin)).not.toContain(
    replacement.vins[0] ?? "",
  );
  const index = models.indexOf(model);
  const days = Array.from({ length: 6 }, (_, i) => i + 1).find(
    (day) => (Math.floor(start / DAY) + day) % 6 === index % 6,
  );
  if (days === undefined) throw new Error("Missing six-day sweep slot");
  const swept = await run({
    previous: missed.cursor,
    now: start + days * DAY,
    replace,
    arrivals: [knownArrival()],
  });
  expect(readModels(swept)).toContain(tenant.origin + model.model.path);
  expect(swept.vehicles.map((v) => v.vin)).toContain(replacement.vins[0] ?? "");
  expect(swept.vehicles.map((v) => v.vin)).not.toContain(old.vins[0] ?? "");
  expect(days).toBeLessThanOrEqual(6);
});

test("shifted model slices refresh six-day evidence before the seven-day acceptance ceiling", async () => {
  const removed = models[0];
  if (!removed) throw new Error("Missing first model");
  const now = start + 7 * DAY - 1000;
  const result = await run({
    previous: baseline.cursor,
    now,
    remove: removed.model.path,
  });
  expect(readModels(result)).toHaveLength(models.length - 1);
});

test("late chunk retries share the run clock and reserve a full day for acceptance", async () => {
  const now = start + 7 * DAY - 3600_000;
  const result = await run({
    previous: baseline.cursor,
    now,
    clock: (chunk) => now + (chunk === 0 ? 0 : 2 * 3600_000),
  });
  expect(readModels(result)).toHaveLength(models.length);
  expect(result.cursor.asOf).toBe(now);
  const reads: string[] = [];
  await expectBlocked(
    { previous: baseline.cursor, now, fail: target().model.path, reads },
    "offline repeated HTTP500",
  );
});

test("model deferrals checkpoint individually and consecutive distinct failures stop the tenant", async () => {
  const first = await run({
    previous: baseline.cursor,
    badge: target().model.path,
    fail: target().model.path,
    maxPages: 3,
  });
  const deferred = first.checkpoints.find((c) => c.deferred > 0);
  expect(deferred?.pages).toBe(1);
  // An outage fails every page, so the tenant stops after this many in a row.
  expect(URGIIS_MODEL_FAILURE_STREAK).toBeLessThan(models.length);
  const failures = models
    .slice(0, URGIIS_MODEL_FAILURE_STREAK + 1)
    .map((m) => m.model.path);
  const reads: string[] = [];
  const blocked = await expectBlocked(
    {
      previous: baseline.cursor,
      now: start + DAY,
      fail: failures,
      reads,
      maxPages: 3,
    },
    `${URGIIS_MODEL_FAILURE_STREAK} model pages failed in a row`,
  );
  expect(blocked.cursor.completed[0]).not.toMatchObject({
    blocked: expect.stringContaining("no eligible prior model evidence"),
  });
  expect(
    reads.filter((url) => failures.includes(new URL(url).pathname)),
  ).toHaveLength(URGIIS_MODEL_FAILURE_STREAK);
});

test("model failures separated by successful reads each carry their donors", async () => {
  // Norb's backend times out on its largest models while the rest load.
  const [a, b, c] = models;
  if (!a || !b || !c) throw new Error("Missing three captured models");
  const result = await run({
    previous: baseline.cursor,
    badge: b.model.path,
    fail: [a.model.path, c.model.path],
    maxPages: 3,
  });
  expect(result.cursor.completed[0]).toHaveProperty("accepted");
  expect(result.vehicles).toEqual(baseline.vehicles);
  expect(readModels(result)).toEqual(
    [a, b, c].map((m) => tenant.origin + m.model.path),
  );
  expect(result.checkpoints.some((c) => c.deferred === 2)).toBe(true);
});

test("explicit empties persisting through their later retries each carry their donors", async () => {
  // The November 25 Norb's run: Equinox and another large model rendered
  // "No Results Found" twice, and the second deferral blocked the tenant.
  const [a, b, c] = models;
  if (!a || !b || !c) throw new Error("Missing three captured models");
  const empties = [a.model.path, c.model.path];
  const result = await run({
    previous: baseline.cursor,
    badge: [a.model.path, b.model.path, c.model.path],
    emptyReads: { path: empties, times: 2 },
  });
  expect(result.cursor.completed[0]).toHaveProperty("accepted");
  expect(result.vehicles).toEqual(baseline.vehicles);
  for (const path of empties)
    expect(result.reads.filter((u) => u === tenant.origin + path)).toHaveLength(
      2,
    );
  expect(result.checkpoints.some((c) => c.deferred === 2)).toBe(true);
});

test("consecutive explicit empties stop the tenant before the later retries", async () => {
  const empties = models
    .slice(0, URGIIS_MODEL_FAILURE_STREAK + 1)
    .map((m) => m.model.path);
  const result = await expectBlocked(
    {
      previous: baseline.cursor,
      badge: empties,
      emptyReads: { path: empties, times: 2 },
    },
    `${URGIIS_MODEL_FAILURE_STREAK} model pages failed in a row`,
  );
  expect(
    result.reads.filter((url) => empties.includes(new URL(url).pathname)),
  ).toHaveLength(URGIIS_MODEL_FAILURE_STREAK);
});

test("broken model route rule recognizes native punctuation and ampersand slugs only", () => {
  for (const [label, slug] of [
    ["Town & Country", "TOWN_-and_COUNTRY"],
    ["Lincoln Town Car", "LINCOLN_-and_TOWN_CAR"],
    ["Chevrolet Pass.", "CHEVROLET_PASS."],
    ["Blazer/Jimmy (Full Size)", "BLAZER.JIMMY_(FULL_SIZE)"],
    ["Safari (GMC)", "SAFARI_%28GMC%29"],
  ])
    expect(
      urgiisBrokenModelRoute({
        label: label ?? "",
        path: `/parts/MAKE/${slug}/`,
        count: 2,
      }),
    ).toBe(true);
  for (const label of [
    "EQUINOX",
    "ATLAS",
    "TOWN_CAR",
    "GRAND_CARAVAN",
    "LAND_AND_RANGE",
  ])
    expect(
      urgiisBrokenModelRoute({
        label,
        path: `/parts/MAKE/${label}/`,
        count: 2,
      }),
    ).toBe(false);
});
test("special-slug unreachable donors within 1% publish with model counts in a warning", async () => {
  const result = await run({
    specialCount: 2,
    badge: target().model.path,
    badgeCount:
      200 -
      models.reduce((n, m) => n + m.model.count, 0) +
      target().model.count -
      2,
  });
  expect(result.vehicles).toEqual(baseline.vehicles);
  expect(
    result.warnings.some(
      (w) =>
        w.includes("platform-unreachable") && w.includes("Town & Country: 2"),
    ),
  ).toBe(true);
});
test("special-slug unreachable donors above 1% block the tenant", async () => {
  const result = await run({ specialCount: 200 });
  expect(result.vehicles).toEqual([]);
  expect(result.cursor.completed[0]).toMatchObject({
    blocked: expect.stringContaining("maximum is 1%"),
  });
});
test("ordinary explicit empty is retried later and carries prior accepted donors", async () => {
  const path = target().model.path;
  const result = await run({
    previous: baseline.cursor,
    badge: path,
    emptyReads: { path, times: 2 },
  });
  expect(result.vehicles).toEqual(baseline.vehicles);
  expect(result.reads.filter((u) => u === tenant.origin + path)).toHaveLength(
    2,
  );
  expect(
    result.warnings.some((w) => w.includes("later retry; retaining donors")),
  ).toBe(true);
  expect(result.checkpoints.some((c) => c.deferred === 1)).toBe(true);
});
test("ordinary explicit empty cannot extend the six-day carry age bound", async () => {
  const path = target().model.path;
  const result = await run({
    previous: baseline.cursor,
    now: start + 6 * DAY,
    emptyReads: { path, times: 2 },
  });
  expect(result.vehicles).toEqual([]);
  expect(result.cursor.completed[0]).toHaveProperty("blocked");
});
test("cold ordinary empty blocks only that tenant and the following tenant publishes", async () => {
  const path = target().model.path;
  const result = await run({
    tenantList: [tenant, { ...tenant, code: "healthy" }],
    emptyTenant: tenant.code,
    emptyReads: { path, times: 2 },
  });
  expect(result.cursor.completed[0]).toHaveProperty("blocked");
  expect(result.cursor.completed[1]).toHaveProperty("accepted");
  expect(result.vehicles).toEqual(baseline.vehicles);
});
test("an intermittent ordinary empty recovers on the later retry", async () => {
  const path = target().model.path;
  const result = await run({ emptyReads: { path, times: 1 } });
  expect(result.vehicles).toEqual(baseline.vehicles);
  const first = result.reads.indexOf(tenant.origin + path);
  const retry = result.reads.lastIndexOf(tenant.origin + path);
  expect(retry).toBeGreaterThan(first + 1);
});

test("closing badges reapply the aggregate 1% unreachable limit", async () => {
  const result = await run({
    specialCount: 2,
    closingSpecialCount: 3,
    badge: target().model.path,
    badgeCount: 200,
  });
  expect(result.vehicles).toEqual([]);
  expect(result.cursor.completed[0]).toMatchObject({
    blocked: expect.stringContaining("maximum is 1%"),
  });
});
test("arrivals-only donors in an unreachable special model retain their arrivals destination", async () => {
  const source = target();
  const record = source.records[0];
  const make = models[0]?.make;
  const denominator = models.find((m) => m.model.path !== source.model.path);
  if (!record || !make || !denominator)
    throw new Error("Missing captured arrival identity");
  const specialPath = make.path.replace(/\/$/, "") + "/TOWN_-and_COUNTRY/";
  const arrival = {
    ...record,
    titles: [make.label + " Town & Country"],
    inquiries: [],
    destinations: [
      tenant.origin + specialPath + record.stock + "/" + record.years[0],
    ],
  };
  const result = await run({
    remove: source.model.path,
    specialCount: 2,
    badge: denominator.model.path,
    badgeCount: 1000,
    arrivals: [arrival],
  });
  expect(
    result.vehicles.find((v) => v.vin === record.vins[0])?.detailsUrl,
  ).toBe(tenant.origin + tenant.arrivalsPath);
});

test("an ordinary empty reaching two donors at closing retries before publication", async () => {
  const path = target().model.path;
  const result = await run({
    badge: path,
    badgeCount: 1,
    closingOrdinary: path,
    emptyReads: { path, times: 1 },
  });
  expect(result.vehicles).toEqual(baseline.vehicles);
  expect(result.reads.filter((u) => u === tenant.origin + path)).toHaveLength(
    2,
  );
  expect(result.cursor.completed[0]).toHaveProperty("accepted");
  expect(result.checkpoints.every((checkpoint) => checkpoint.pages <= 1)).toBe(
    true,
  );
});

test("a cold ordinary closing empty blocks only its tenant after retry", async () => {
  const path = target().model.path;
  const result = await run({
    tenantList: [tenant, { ...tenant, code: "healthy" }],
    emptyTenant: tenant.code,
    badge: path,
    badgeCount: 1,
    closingOrdinary: path,
    emptyReads: { path, times: 2 },
  });
  expect(result.cursor.completed[0]).toHaveProperty("blocked");
  expect(result.cursor.completed[1]).toHaveProperty("accepted");
  expect(result.vehicles).toEqual(baseline.vehicles);
});

test("an ordinary closing empty retries then carries eligible accepted donors", async () => {
  const path = target().model.path;
  const result = await run({
    previous: baseline.cursor,
    arrivals: [knownArrival()],
    badge: path,
    badgeCount: 1,
    closingOrdinary: path,
    emptyReads: { path, times: 2 },
  });
  expect(result.vehicles).toEqual(baseline.vehicles);
  expect(result.reads.filter((u) => u === tenant.origin + path)).toHaveLength(
    2,
  );
  expect(result.checkpoints.some((c) => c.deferred === 1)).toBe(true);
});

test("a carried tiny empty is reread when its closing badge reaches two", async () => {
  const model = target();
  const path = model.model.path;
  const previous = await run({
    badge: path,
    badgeCount: 1,
    replace: { path, records: [] },
  });
  const day = [1, 2].find(
    (d) => (Math.floor(start / DAY) + d) % 6 !== models.indexOf(model) % 6,
  );
  if (day === undefined) throw new Error("Missing non-sweep day");
  const result = await run({
    previous: previous.cursor,
    now: start + day * DAY,
    arrivals: [knownArrival()],
    badge: path,
    badgeCount: 1,
    closingOrdinary: path,
    emptyReads: { path, times: 2 },
  });
  expect(result.vehicles).toEqual(previous.vehicles);
  expect(result.reads.filter((u) => u === tenant.origin + path)).toHaveLength(
    1,
  );
  expect(result.checkpoints.some((c) => c.deferred === 1)).toBe(true);
  expect(result.cursor.completed[0]).toHaveProperty("accepted");
});

test("an ordinary closing empty cannot extend the six-day carry bound", async () => {
  const path = target().model.path;
  const result = await run({
    previous: baseline.cursor,
    now: start + 6 * DAY,
    arrivals: [knownArrival()],
    badge: path,
    badgeCount: 1,
    closingOrdinary: path,
    emptyReads: { path, times: 2 },
  });
  expect(result.vehicles).toEqual([]);
  expect(result.cursor.completed[0]).toHaveProperty("blocked");
});

describe("a tenant missing from the accepted census", () => {
  const second = { ...tenant, code: "second" };
  const pair = [tenant, second];
  // Blocks the second tenant at its first page, after three reads.
  const blockSecond = { fail: tenant.ownerPath, failTenant: second.code };
  // Later chunks run 30 hours after the run starts: past a one-day deadline.
  const late = (now: number) => (chunk: number) =>
    chunk === 0 ? now : now + 30 * 3600_000;
  const modelReads = (result: Awaited<ReturnType<typeof run>>) =>
    readModels(result).length;

  test("after a cold census that blocked it, gets a three-day recovery run", async () => {
    const cold = await run({ tenantList: pair, now: start, ...blockSecond });
    expect(cold.cursor.completed).toEqual([
      { code: tenant.code, accepted: expect.any(Number) },
      { code: second.code, blocked: expect.stringContaining("HTTP500") },
    ]);
    const now = start + DAY;
    const recovery = await run({
      tenantList: pair,
      previous: cold.cursor,
      now,
      clock: late(now),
    });
    expect(recovery.cursor.runKind).toBe("recovery");
    expect(recovery.cursor.completed).toEqual([
      { code: tenant.code, accepted: expect.any(Number) },
      { code: second.code, accepted: expect.any(Number) },
    ]);
    // The missing tenant reads every model; the other carries a day-old
    // census and reads only today's slice.
    const slice = models.filter(
      (_, index) => index % 6 === Math.floor(now / DAY) % 6,
    ).length;
    expect(modelReads(recovery)).toBe(models.length + slice);
    const next = await run({
      tenantList: pair,
      previous: recovery.cursor,
      now: now + DAY,
    });
    expect(next.cursor.runKind).toBe("incremental");
  });

  test("after six days blocked, recovers in a three-day run that rereads evidence four days old", async () => {
    const cold = await run({ tenantList: pair, now: start });
    const blocked = await run({
      tenantList: pair,
      previous: cold.cursor,
      now: start + DAY,
      ...blockSecond,
    });
    expect(blocked.cursor.completed[1]).toHaveProperty("blocked");
    const now = start + 6 * DAY + 3600_000;
    const recovery = await run({
      tenantList: pair,
      previous: blocked.cursor,
      now,
      clock: late(now),
    });
    expect(recovery.cursor.runKind).toBe("recovery");
    expect(recovery.cursor.completed).toEqual([
      { code: tenant.code, accepted: expect.any(Number) },
      { code: second.code, accepted: expect.any(Number) },
    ]);
    // Three days of run plus under four days of carry stays under seven:
    // both tenants reread every model, including those read five days ago.
    expect(modelReads(recovery)).toBe(2 * models.length);
  });

  test("a recovery run fails only at its three-day deadline", async () => {
    const cold = await run({ tenantList: pair, now: start, ...blockSecond });
    const now = start + DAY;
    const after = (offset: number) => (chunk: number) =>
      chunk === 0 ? now : now + offset;
    const recovery = await run({
      tenantList: pair,
      previous: cold.cursor,
      now,
      clock: after(3 * DAY - 9 * 60_000),
    });
    expect(recovery.cursor.runKind).toBe("recovery");
    await expect(
      run({
        tenantList: pair,
        previous: cold.cursor,
        now,
        clock: after(3 * DAY - 7 * 60_000),
      }),
    ).rejects.toThrow("three-day recovery census deadline");
  });

  test("a recovery run carries evidence under four days old and rereads older evidence", async () => {
    const cold = await run({ tenantList: pair, now: start });
    // Only the first tenant reads models while the second stays blocked.
    let previous: unknown = cold.cursor;
    const daily: string[][] = [];
    for (const day of [1, 2, 3]) {
      const result = await run({
        tenantList: pair,
        previous,
        now: start + day * DAY,
        ...blockSecond,
      });
      expect(result.cursor.runKind).toBe("incremental");
      daily.push(readModels(result));
      previous = result.cursor;
    }
    const [, dayTwo = [], dayThree = []] = daily;
    const reread = dayTwo.filter((url) => !dayThree.includes(url));
    // A four-day boundary must separate these, or the test proves nothing.
    expect(reread.length).toBeGreaterThan(0);
    expect(dayThree.length).toBeGreaterThan(0);
    const recovery = await run({
      tenantList: pair,
      previous,
      now: start + 6 * DAY + 3600_000,
    });
    expect(recovery.cursor.runKind).toBe("recovery");
    // Day-three evidence is 3d1h old and carries; day-two evidence is 4d1h
    // old and is reread. The second tenant rereads every model.
    const firstTenantReads = readModels(recovery).length - models.length;
    expect(firstTenantReads).toBe(models.length - new Set(dayThree).size);
  });
});
