import { beforeAll, expect, test } from "bun:test";
import { Effect } from "effect";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { UrgiisReplayArchive } from "./urgiis-replay-archive";
import { iisCards, iisDirectory } from "./urgiis-catalog";
import { urgiisSnapshot, validateUrgiisSnapshot } from "./urgiis-snapshot";
import { streamUrgiisInventory } from "./urgiis-connector";
import { urgiisError } from "./urgiis-client";
import { UrgiisCursor, URGIIS_MAX_CURSOR_BYTES } from "./urgiis-cursor";
import { URGIIS_DAY_MS as DAY, UrgiisCensus } from "./urgiis-census";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import type { UrgiisControl, UrgiisRecord } from "./urgiis-schema";
import type { CanonicalVehicle } from "./types";

const qualified = URGIIS_TENANTS.find((t) => t.code === "eagle");
if (!qualified) throw new Error("Missing Eagle qualification");
const tenant = { ...qualified, minimumInventory: 1 };
const tenants = [tenant];
const store = IngestionSnapshotStore.memory();
const start = 14 * DAY;
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
              `<div class="card-price"><div class="card-img">${r.image ? `<img src="${escape(r.image)}">` : ""}</div><div class="car-details"><b>Stock:</b>${escape(r.stock ?? "")}<br><b>Year:</b>${escape(r.years[0] ?? "")}<br><b>Make/Model:</b>${escape(r.titles[0] ?? "")}<br><b>VIN:</b>${escape(r.vins[0] ?? "")}<br></div>${r.destinations.map((url) => `<a href="${escape(url)}">See Parts</a>`).join("")}${r.inquiries.map((claim) => `<button data-vehicle="${escape(claim)}">Inquire</button>`).join("")}</div>`,
          )
          .join("")}</div>`,
      )
    : empty;
interface Day {
  previous?: unknown;
  now?: number;
  arrivals?: UrgiisRecord[];
  badge?: string;
  replace?: { path: string; records: UrgiisRecord[] };
  fail?: string;
  drift?: string;
  malformed?: string;
  remove?: string;
}
async function run(day: Day = {}) {
  const now = day.now ?? start + 3600_000;
  let cursor = UrgiisCursor.initial(tenants);
  const reads: string[] = [];
  const vehicles: CanonicalVehicle[] = [];
  const warnings: string[] = [];
  let peakCursorBytes = 0;
  const active = models.filter((m) => m.model.path !== day.remove);
  const makes = [...new Map(active.map((m) => [m.make.path, m.make])).values()];
  for (let chunks = 0; cursor.phase !== "complete" && chunks < 200; chunks++) {
    const result = await Effect.runPromise(
      streamUrgiisInventory({
        tenants,
        startCursor: cursor,
        previousCursor: day.previous,
        now,
        loadCensus: async (path) => (await store.load(path)).checkpointState,
        maxPages: 1,
        readPage: (url) => {
          reads.push(url);
          const path = new URL(url).pathname;
          if (path === day.fail)
            return Effect.fail(
              urgiisError("request/body " + url, "offline repeated HTTP500"),
            );
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
                count: m.model.count + (m.model.path === day.badge ? 1 : 0),
              }));
            if (day.drift === path && reads.filter((u) => u === url).length > 1)
              controls.reverse();
            return Effect.succeed(directory(controls, "menu"));
          }
          const model = active.find((m) => m.model.path === path);
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
    const wire = UrgiisCursor.serialize(next, tenants);
    peakCursorBytes = Math.max(
      peakCursorBytes,
      new TextEncoder().encode(wire).length,
    );
    cursor = UrgiisCursor.fromWire(wire, tenants);
  }
  expect(cursor.phase).toBe("complete");
  return { cursor, reads, vehicles, warnings, peakCursorBytes };
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
        if (models.length === 7) break;
      }
      if (models.length === 7) break;
    }
    expect(models).toHaveLength(7);
    baseline = await run({ now: start });
  } finally {
    archive.close();
  }
});

test("first census reads every saved model; unchanged day reads only ownership, menus and arrivals", async () => {
  expect(readModels(baseline)).toHaveLength(7);
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
    arrivals: [replacement],
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
  const result = await run({ previous: previous.cursor, arrivals: [arrival] });
  expect(readModels(result)).toEqual([tenant.origin + model.model.path]);
  expect(result.vehicles.map((v) => v.vin)).toContain(known.vins[0] ?? "");
  expect(result.vehicles.map((v) => v.vin)).toContain(arrival.vins[0] ?? "");
});
test("rolling slices reread one seventh daily starting immediately after bootstrap", async () => {
  let previous = baseline.cursor;
  const swept: string[] = [];
  for (let day = 1; day <= 7; day++) {
    const result = await run({ previous, now: start + day * DAY });
    expect(readModels(result)).toHaveLength(1);
    swept.push(...readModels(result));
    previous = result.cursor;
  }
  expect(new Set(swept).size).toBe(7);
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
    expect(readModels(result)).toHaveLength(7);
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
  ).toHaveLength(7);
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
  await expect(
    run({ previous: retried.cursor, fail: path, now: start + 7 * DAY }),
  ).rejects.toThrow("offline repeated HTTP500");
  const recovered = await run({ previous: failed.cursor, badge: path });
  expect(readModels(recovered)).toEqual([tenant.origin + path]);
});
test("first-census page failures and parse/structural drift never use a carry", async () => {
  await expect(run({ fail: target().model.path })).rejects.toThrow(
    "offline repeated HTTP500",
  );
  await expect(
    run({
      previous: baseline.cursor,
      badge: target().model.path,
      malformed: target().model.path,
    }),
  ).rejects.toThrow("supplier");
  const make = models.find(
    (m) => models.filter((x) => x.make.path === m.make.path).length > 1,
  )?.make;
  if (!make) throw new Error("Missing multi-model captured menu");
  await expect(
    run({ previous: baseline.cursor, drift: make.path }),
  ).rejects.toThrow("paths or labels changed");
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
  await expect(
    run({
      previous: baseline.cursor,
      arrivals: Array.from({ length: 100 }, () => rejected),
    }),
  ).rejects.toThrow("admission");
});
