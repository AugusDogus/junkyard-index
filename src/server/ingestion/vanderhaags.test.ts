import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, test } from "bun:test";
import { Effect } from "effect";
import { z } from "zod";
import {
  parseVanderHaagsPage,
  parseVanderHaagsDetail,
  VANDERHAAGS_CATALOG_PATH,
} from "./vanderhaags-catalog";
import { inventoryVinWithCheckDigit } from "./inventory-vin-check-digit";
import { transformVanderHaagsDonor } from "./vanderhaags-transform";
import {
  VanderHaagsCursorSchema,
  type VanderHaagsCursor,
} from "./vanderhaags-cursor";
import {
  streamVanderHaagsInventoryFromSource,
  type VanderHaagsStreamResult,
} from "./vanderhaags-connector";
import type { CanonicalVehicle } from "./types";

const fixture = (name: string) =>
  readFileSync(
    new URL("./fixtures/vanderhaags/" + name, import.meta.url),
    "utf8",
  );
const html = fixture("catalog.html");
const detail = fixture("26038856.html");
const donor = parseVanderHaagsPage(html, 1).donors[0];
if (!donor) throw new Error("Missing native Vander Haags fixture donor");
const nativeDonor = donor;

test("all five captured native catalog pages reconcile to 2,112 national and 287 Sioux Falls donors", () => {
  const pages = z
    .array(z.object({ page: z.number().int(), html: z.string() }))
    .parse(
      JSON.parse(
        gunzipSync(
          readFileSync(
            new URL(
              "./fixtures/vanderhaags/catalog-pages.json.gz",
              import.meta.url,
            ),
          ),
        ).toString("utf8"),
      ),
    );
  expect(pages.map((p) => p.page)).toEqual([1, 2, 3, 4, 5]);
  const catalogs = pages.map((p) => parseVanderHaagsPage(p.html, p.page));
  expect(catalogs.every((p) => p.total === 2112)).toBe(true);
  expect(catalogs.map((p) => p.donors.length)).toEqual([
    500, 500, 500, 500, 112,
  ]);
  const donors = catalogs.flatMap((p) => p.donors);
  expect(new Set(donors.map((d) => d.id)).size).toBe(2112);
  const selected = donors.filter((d) => d.yard === "Sioux Falls, SD");
  expect(selected).toHaveLength(287);
  expect(new Set(selected.map((d) => d.stock)).size).toBe(287);
});

test("native card, specifications, stock, yard and VIN produce a donor destination", () => {
  const fields = parseVanderHaagsDetail(detail, nativeDonor);
  const result = transformVanderHaagsDonor(nativeDonor, fields);
  expect(result).toMatchObject({
    status: "available",
    vehicle: {
      vin: "2NKHHM7X6HM164968",
      year: 2017,
      make: "Kenworth",
      model: "T370",
      locationCode: "sioux-falls",
      stateAbbr: "SD",
      stockNumber: "17KN110",
      detailsUrl: "https://www.vanderhaags.com/detailview.php?part=26038856",
      availableDate: null,
    },
  });
});

test("native omitted Price row closing tag remains valid HTML", () => {
  const omitted = detail.replace(/(<td>\$0\.00[^]*?<\/td>)\s*<\/tr>/, "$1");
  expect(parseVanderHaagsDetail(omitted, nativeDonor).get("VIN:")).toBe(
    "2NKHHM7X6HM164968",
  );
});

test("longest published make preserves Western Star and pre-1981 serials", () => {
  for (const [id, title, stock, make, model] of [
    [
      "26074031",
      "2000 Western Star Trucks 4900EX Parts Unit: Truck Dsl Ta",
      "00WS028",
      "Western Star",
      "4900EX",
    ],
    [
      "25995129",
      "1978 Ottawa YT Parts Unit: Truck Dsl Sa",
      "78MI012",
      "Ottawa",
      "YT",
    ],
  ]) {
    if (!id || !title || !stock) throw new Error("Incomplete fixture identity");
    const page = fixture(id + ".html");
    const fields = parseVanderHaagsDetail(page, {
      ...nativeDonor,
      id,
      title,
      stock,
    });
    expect(
      transformVanderHaagsDonor({ ...nativeDonor, id, title, stock }, fields),
    ).toMatchObject({ status: "available", vehicle: { make, model } });
  }
});

test("invalid check digits and conflicting descriptions retain presence without publishing", () => {
  const fields = parseVanderHaagsDetail(detail, nativeDonor);
  expect(
    transformVanderHaagsDonor(
      nativeDonor,
      new Map(fields).set("VIN:", "2NKHHM7X0HM164968"),
    ),
  ).toEqual({ status: "rejected", vin: "2NKHHM7X0HM164968" });
  expect(
    transformVanderHaagsDonor(
      nativeDonor,
      new Map(fields).set("Vehicle Info:", "2017 Kenworth T800"),
    ),
  ).toEqual({ status: "rejected", vin: "2NKHHM7X6HM164968" });
});

test("catalog rejects incomplete, repeated, wrong-scope and wrong-page responses", () => {
  for (const bad of [
    html.slice(0, -30),
    html.replace("recordcount=1", "recordcount=2"),
    html.replace("parts-unit", "equipment-parts-unit"),
    html.replace("page=1", "page=2"),
  ])
    expect(() => parseVanderHaagsPage(bad, 1)).toThrow();
  for (const bad of [
    detail.replace("26038856", "26038857"),
    detail.replace("Sioux Falls, SD", "Spencer, IA"),
    detail.replace("17KN110", "17KN111"),
    detail.slice(0, -30),
  ])
    expect(() => parseVanderHaagsDetail(bad, nativeDonor)).toThrow();
});

// Change only identity fields in the native captured markup for a bounded census.
const ids = Array.from({ length: 96 }, (_, i) => String(26038856 + i));
const vins = ids.map((_, i) => {
  const base = "2NKHHM7X6HM" + String(164968 + i);
  for (const digit of "0123456789X") {
    const candidate = base.slice(0, 8) + digit + base.slice(9);
    if (inventoryVinWithCheckDigit(candidate, "2017")) return candidate;
  }
  throw new Error("Unable to construct a fixture VIN");
});
const card = /<div class="item-card"[^]*?<\/div>\s*<\/span>/
  .exec(html)?.[0]
  .replace(/<\/span>$/, "");
if (!card) throw new Error("Missing native card fixture");
const nativeCard = card;
function catalogPage(size = 96) {
  const cards = ids
    .slice(0, size)
    .map((id, i) =>
      nativeCard.replaceAll("26038856", id).replaceAll("17KN110", "TEST" + i),
    )
    .join("");
  return html
    .replace(nativeCard, cards)
    .replace("recordcount=1", "recordcount=" + size);
}
function detailPage(id: string, duplicate = false) {
  const index = ids.indexOf(id);
  return detail
    .replaceAll("26038856", id)
    .replaceAll("17KN110", "TEST" + index)
    .replaceAll("2NKHHM7X6HM164968", vins[duplicate ? 0 : index] ?? "");
}

test("checkpoints enumerate serially, resume without duplicate emissions, and fence completion", async () => {
  const requests: string[] = [];
  const vehicles: CanonicalVehicle[] = [];
  const source = {
    fetchPage: (path: string) => {
      requests.push(path);
      return Effect.succeed(
        path === VANDERHAAGS_CATALOG_PATH
          ? catalogPage()
          : detailPage(path.split("=")[1] ?? ""),
      );
    },
  };
  let cursor: VanderHaagsCursor = { source: "vanderhaags", phase: "start" };
  for (let chunk = 0; chunk < 4; chunk++) {
    const result: VanderHaagsStreamResult = await Effect.runPromise(
      streamVanderHaagsInventoryFromSource(
        {
          startCursor: cursor,
          maxPages: 24,
          onBatch: (v) =>
            Effect.sync(() => {
              vehicles.push(...v);
            }),
        },
        source,
      ),
    );
    cursor = VanderHaagsCursorSchema.parse(result.cursor);
    expect(result.count).toBe(24);
    expect(result.status).toBe(chunk === 3 ? "complete" : "paused");
  }
  expect(vehicles).toHaveLength(96);
  expect(new Set(vehicles.map((v) => v.vin)).size).toBe(96);
  expect(requests.filter((p) => p === VANDERHAAGS_CATALOG_PATH)).toHaveLength(
    5,
  );
  expect(requests).toHaveLength(101);
});

test("duplicate VINs across checkpoints block reconciliation", async () => {
  const source = {
    fetchPage: (path: string) =>
      Effect.succeed(
        path === VANDERHAAGS_CATALOG_PATH
          ? catalogPage()
          : detailPage(path.split("=")[1] ?? "", true),
      ),
  };
  const options = { maxPages: 1, onBatch: () => Effect.void };
  const first = await Effect.runPromise(
    streamVanderHaagsInventoryFromSource(options, source),
  );
  await expect(
    Effect.runPromise(
      streamVanderHaagsInventoryFromSource(
        { ...options, startCursor: first.cursor },
        source,
      ),
    ),
  ).rejects.toThrow("repeated VIN");
});

test("the Sioux Falls census floor blocks a reduced catalog before emission", async () => {
  let emitted = false;
  const source = { fetchPage: () => Effect.succeed(catalogPage(94)) };
  await expect(
    Effect.runPromise(
      streamVanderHaagsInventoryFromSource(
        {
          onBatch: () =>
            Effect.sync(() => {
              emitted = true;
            }),
        },
        source,
      ),
    ),
  ).rejects.toThrow("below 95 donors");
  expect(emitted).toBe(false);
});

test("cumulative rejection accounting survives checkpoints and blocks an unhealthy completion", async () => {
  const source = {
    fetchPage: (path: string) => {
      if (path === VANDERHAAGS_CATALOG_PATH)
        return Effect.succeed(catalogPage());
      const id = path.split("=")[1] ?? "";
      const page = detailPage(id);
      return Effect.succeed(
        ids.indexOf(id) < 11 ? page.replace(/2NKHHM7X[A-Z0-9]{9}/, "") : page,
      );
    },
  };
  let cursor: VanderHaagsCursor = { source: "vanderhaags", phase: "start" };
  for (let chunk = 0; chunk < 3; chunk++) {
    const result: VanderHaagsStreamResult = await Effect.runPromise(
      streamVanderHaagsInventoryFromSource(
        { startCursor: cursor, maxPages: 24, onBatch: () => Effect.void },
        source,
      ),
    );
    cursor = result.cursor;
  }
  await expect(
    Effect.runPromise(
      streamVanderHaagsInventoryFromSource(
        { startCursor: cursor, maxPages: 24, onBatch: () => Effect.void },
        source,
      ),
    ),
  ).rejects.toThrow("10% rejected donor limit");
});

test("changed catalog and failed closing fence never emit the affected checkpoint", async () => {
  let catalogRequests = 0;
  let emitted = 0;
  const source = {
    fetchPage: (path: string) => {
      if (path !== VANDERHAAGS_CATALOG_PATH)
        return Effect.succeed(detailPage(path.split("=")[1] ?? ""));
      catalogRequests++;
      return Effect.succeed(
        catalogRequests === 5
          ? catalogPage().replace("TEST0", "CHANGED")
          : catalogPage(),
      );
    },
  };
  let cursor: VanderHaagsCursor = { source: "vanderhaags", phase: "start" };
  for (let chunk = 0; chunk < 3; chunk++) {
    const result: VanderHaagsStreamResult = await Effect.runPromise(
      streamVanderHaagsInventoryFromSource(
        {
          startCursor: cursor,
          maxPages: 24,
          onBatch: () =>
            Effect.sync(() => {
              emitted += 24;
            }),
        },
        source,
      ),
    );
    cursor = result.cursor;
  }
  await expect(
    Effect.runPromise(
      streamVanderHaagsInventoryFromSource(
        {
          startCursor: cursor,
          maxPages: 24,
          onBatch: () =>
            Effect.sync(() => {
              emitted += 24;
            }),
        },
        source,
      ),
    ),
  ).rejects.toThrow("changed before completion");
  expect(emitted).toBe(72);
});
