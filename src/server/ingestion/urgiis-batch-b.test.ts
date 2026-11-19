import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { z } from "zod";
import {
  iisCards,
  iisDirectory,
  iisDocument,
  iisValidateModelPage,
} from "./urgiis-catalog";
import { iisAttribute } from "./iis-html";
import { expect, test } from "bun:test";
import { Effect } from "effect";
import { streamUrgiisInventory } from "./urgiis-connector";
import { UrgiisCursor } from "./urgiis-cursor";
import { urgiisError } from "./urgiis-client";
import { UrgiisReplayArchive } from "./urgiis-replay-archive";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { validateUrgiisSnapshot } from "./urgiis-snapshot";
import { URGIIS_EMPTY_MODEL_MINIMUM } from "./urgiis-schema";
import type { UrgiisTenant } from "./urgiis-tenant";

for (const census of [
  {
    code: "premier",
    makes: 35,
    models: 264,
    incomplete: ["/parts/CHRYSLER/TOWN_-and_COUNTRY/"],
  },
  {
    code: "junior-sinn",
    makes: 40,
    models: 355,
    incomplete: [
      "/parts/CHEVROLET/BLAZER.JIMMY_(FULL_SIZE)/",
      "/parts/CHRYSLER/TOWN_-and_COUNTRY/",
      "/parts/LINCOLN/LINCOLN_-and_TOWN_CAR/",
    ],
  },
  {
    code: "revolution",
    makes: 43,
    models: 389,
    incomplete: [
      "/parts/CHEVROLET/EQUINOX/",
      "/parts/CHRYSLER/TOWN_-and_COUNTRY/",
      "/parts/LINCOLN/LINCOLN_-and_TOWN_CAR/",
    ],
  },
]) {
  test(`URG qualification checks every ${census.code} model for native cutoffs and badged empty results`, async () => {
    const tenant = URGIIS_TENANTS.find((item) => item.code === census.code);
    if (!tenant) throw new Error("Missing qualified tenant " + census.code);
    const archive = await UrgiisReplayArchive.open(census.code);
    const makes = new Map<string, ReturnType<typeof iisDirectory>[number]>();
    const models = new Map<string, ReturnType<typeof iisDirectory>[number]>();
    const seen = new Set<string>();
    let checked = 0;
    let largest = 0;
    const incomplete: string[] = [];
    try {
      let response;
      while ((response = await archive.next())) {
        if (seen.has(response.url)) continue;
        seen.add(response.url);
        const path = new URL(response.url).pathname;
        if (path === tenant.makesPath) {
          for (const make of iisDirectory(response.html, tenant))
            makes.set(make.path, make);
        } else {
          const make = makes.get(path);
          if (make) {
            for (const model of iisDirectory(response.html, tenant, make))
              models.set(model.path, model);
          } else {
            const model = models.get(path);
            if (!model) continue;
            const page = iisCards(response.html, tenant);
            expect(page.capped).toBe(false);
            if (page.nativeEmpty && model.count >= URGIIS_EMPTY_MODEL_MINIMUM) {
              expect(() => iisValidateModelPage(page, model)).toThrow(
                "enumeration is incomplete",
              );
              incomplete.push(model.path);
            } else iisValidateModelPage(page, model);
            expect(page.records.length === 30 && model.count > 30).toBe(false);
            largest = Math.max(largest, page.records.length);
            checked++;
          }
        }
      }
      expect(incomplete).toEqual(census.incomplete);
      expect(makes.size).toBe(census.makes);
      expect(models.size).toBe(census.models);
      expect(checked).toBe(census.models);
      expect(largest).toBeGreaterThan(30);
      expect(tenant.minimumInventory).toBe(
        Math.floor(archive.expected.accepted / 3),
      );
    } finally {
      archive.close();
    }
  }, 60_000);
}

const rejectedTenants: readonly UrgiisTenant[] = [
  {
    code: "74-auto",
    origin: "https://74autoparts.com",
    urgid: "MO23",
    pathStyle: "parts",
    makesPath: "/parts/makes/",
    ownerPath: "/",
    arrivalsPath: "/latest-arrivals/",
    ownerClaims: ["74 Auto Parts", "1228 State Hwy H", "Sikeston, MO 63801"],
    cookie: "urg_hv=1",
    pacingMs: 3500,
    requestTimeoutMs: 90000,
    minimumInventory: 1,
    photoCodes: ["mo23"],
    skipBlankVin: false,
    placeholderStocks: [],
    attribution: {
      kind: "site",
    },
    yard: {
      source: "urgiis",
      code: "74-auto",
      name: "74 Auto Parts",
      operator: "74 Auto Parts",
      address: "1228 State Hwy H",
      city: "Sikeston",
      state: "MO",
      postalCode: "63801",
      lat: 36.926552046265,
      lng: -89.538210071494,
      phone: "573-475-8555",
      email: null,
      websiteUrl: "https://74autoparts.com/",
    },
  },
  {
    code: "airport",
    origin: "https://airportautopartsinc.com",
    urgid: "OH27",
    pathStyle: "parts",
    makesPath: "/parts/makes/",
    ownerPath: "/",
    arrivalsPath: "/recent-arrivals/",
    ownerClaims: [
      "Airport Auto Parts, Inc.",
      "1355 South Berkey Southern Rd",
      "Swanton, OH 43558",
    ],
    cookie: "urg_hv=1",
    pacingMs: 3500,
    requestTimeoutMs: 90000,
    minimumInventory: 1,
    photoCodes: ["oh27"],
    skipBlankVin: false,
    placeholderStocks: [],
    attribution: { kind: "site" },
    yard: {
      source: "urgiis",
      code: "airport",
      name: "Airport Auto Parts",
      operator: "Airport Auto Parts",
      address: "1355 South Berkey Southern Rd",
      city: "Swanton",
      state: "OH",
      postalCode: "43558",
      lat: 41.6140327,
      lng: -83.8246688,
      phone: "419-826-1361",
      email: null,
      websiteUrl: "https://airportautopartsinc.com/",
    },
  },
];

for (const tenant of rejectedTenants) {
  test(`URG IIS rejects ${tenant.yard.name}'s complete census without publishing donors`, async () => {
    expect(
      URGIIS_TENANTS.some((candidate) => candidate.code === tenant.code),
    ).toBe(false);
    const archive = await UrgiisReplayArchive.open(
      tenant.code + "-rejected-census",
    );
    const assessed = await UrgiisReplayArchive.assess(
      tenant.code + "-rejected-census",
      tenant,
    );
    expect(assessed.accounting).toMatchObject({
      recordsProcessed: archive.expected.recordsProcessed,
      recordsRejected: archive.expected.recordsRejected,
      recordsExcluded: archive.expected.recordsExcluded,
      duplicateVehicles: archive.expected.duplicateVehicles,
    });
    expect(() => validateUrgiisSnapshot(assessed, tenant)).toThrow("rejected");
    let cursor = UrgiisCursor.initial([tenant]);
    let reads = 0;
    const emptyResponses = new Map<string, string>();
    let published = false;
    try {
      while (cursor.phase !== "complete") {
        const result = await Effect.runPromise(
          streamUrgiisInventory({
            tenants: [tenant],
            startCursor: cursor,
            maxPages: 3,
            readPage: (url) =>
              Effect.tryPromise({
                try: async () => {
                  if (emptyResponses.has(url)) {
                    reads++;
                    return emptyResponses.get(url) ?? "";
                  }
                  const response = await archive.next();
                  reads++;
                  if (!response || response.url !== url)
                    throw new Error("Unexpected failed-census request " + url);
                  if (
                    new URL(url).pathname.split("/").filter(Boolean).length ===
                      3 &&
                    /No Results/i.test(response.html) &&
                    iisCards(response.html, tenant).nativeEmpty
                  )
                    emptyResponses.set(url, response.html);
                  return response.html;
                },
                catch: (cause) => urgiisError("offline rejected census", cause),
              }),
            onBatch: () =>
              Effect.sync(() => {
                published = true;
              }),
          }).pipe(Effect.either),
        );
        if (result._tag === "Left") {
          // Shared host and chunk clock failures carry no URG operation.
          if (!("operation" in result.left)) throw result.left;
          expect(result.left.operation).toBe("snapshot " + tenant.code);
          expect(result.left.message).toContain("failed admission");
          expect(
            archive.expected.recordsRejected /
              (archive.expected.recordsProcessed -
                archive.expected.recordsExcluded),
          ).toBeGreaterThan(0.1);
          expect(reads).toBe(archive.responseCount);
          expect(published).toBe(false);
          return;
        }
        if (result.right.cursor.completed.some((c) => "blocked" in c)) {
          expect(published).toBe(false);
          expect(result.right.cursor.completed[0]).toMatchObject({
            blocked: expect.stringContaining(
              "still returns an explicit empty result",
            ),
          });
          const snapshot = await UrgiisReplayArchive.assess(
            tenant.code + "-rejected-census",
            tenant,
          );
          expect(() => validateUrgiisSnapshot(snapshot, tenant)).toThrow(
            "failed admission",
          );
          return;
        }
        expect(result.right.status).toBe("paused");
        cursor = UrgiisCursor.fromWire(
          UrgiisCursor.serialize(result.right.cursor, [tenant]),
          [tenant],
        );
      }
      throw new Error(
        tenant.code + " rejected census completed without its admission error",
      );
    } finally {
      archive.close();
    }
  }, 120_000);
}

test("URG qualification excludes Creston's 30-card pages with a verified missing donor", () => {
  expect(URGIIS_TENANTS.some((tenant) => tenant.code === "creston")).toBe(
    false,
  );
  const archive = brotliDecompressSync(
    readFileSync(
      new URL(
        "./urgiis-test-fixtures/creston-excluded-audit.jsonl.br",
        import.meta.url,
      ),
    ),
  ).toString();
  const responses = archive
    .trim()
    .split("\n")
    .slice(1)
    .map((line) =>
      z
        .object({ key: z.string(), url: z.string().url(), html: z.string() })
        .parse(JSON.parse(line)),
    );
  const origin = "https://crestonautorecycling.com";
  const site = { origin, urgid: "II57", pathStyle: "parts" as const };
  const makes = responses.find((response) => response.key === "makes");
  const menu = responses.find(
    (response) => response.url === origin + "/parts/FORD",
  );
  const model = responses.find(
    (response) => response.url === origin + "/parts/FORD/FORD_F150_PICKUP/",
  );
  const arrivals = responses.find(
    (response) => response.key === "probe-arrivals",
  );
  const detail = responses.find(
    (response) => response.key === "probe-missing-donor",
  );
  const paged = responses.find((response) => response.key === "probe-paged-2");
  const alias = responses.find(
    (response) => response.key === "probe-model-alias",
  );
  if (!makes || !menu || !model || !arrivals || !detail || !paged || !alias)
    throw new Error("Creston qualification evidence is incomplete");
  const make = iisDirectory(makes.html, site).find(
    (control) => control.path === "/parts/FORD",
  );
  if (!make) throw new Error("Creston's published Ford directory is missing");
  expect(
    iisDirectory(menu.html, site, make).find(
      (control) => control.path === "/parts/FORD/FORD_F150_PICKUP/",
    )?.count,
  ).toBe(216);
  const page = iisCards(model.html, site);
  expect(page.records).toHaveLength(30);
  expect(iisCards(paged.html, site).records).toEqual(page.records);
  expect(iisCards(alias.html, site).nativeEmpty).toBe(true);
  const vin = "1FTPX14556NB44449";
  const donor = iisCards(arrivals.html, site, "arrivals").records.find(
    (record) => record.stock === "VJ0809",
  );
  expect(donor?.vins).toEqual([vin]);
  expect(donor?.image).toStartWith(
    "https://da8h1v3w8q6n5.cloudfront.net/ii57/images/VJ0809/",
  );
  expect(page.records.some((record) => record.vins.includes(vin))).toBe(false);
  const html = iisDocument(detail.html, site);
  expect(html).toContain(vin);
  const suppliers = [...html.matchAll(/<input\b[^>]*>/gi)].flatMap(([tag]) =>
    iisAttribute(tag, "name") === "sellingurgid"
      ? [iisAttribute(tag, "value")]
      : [],
  );
  expect([...new Set(suppliers)]).toEqual(["II57"]);
});

test("URG model route probes preserve intermittent empties and reject unsupported slug fixes", () => {
  const responses = z
    .object({
      responses: z.array(
        z.object({
          tenant: z.string(),
          urgid: z.string(),
          url: z.string().url(),
          status: z.literal(200),
          finalUrl: z.string().url(),
          html: z.string(),
          startedAt: z.number(),
          finishedAt: z.number(),
        }),
      ),
    })
    .parse(
      JSON.parse(
        brotliDecompressSync(
          readFileSync(
            new URL(
              "./urgiis-test-fixtures/model-route-probes.json.br",
              import.meta.url,
            ),
          ),
        ).toString(),
      ),
    ).responses;
  expect(responses).toHaveLength(8);
  for (const [index, response] of responses.entries()) {
    if (index > 0)
      expect(
        response.startedAt - (responses[index - 1]?.finishedAt ?? 0),
      ).toBeGreaterThanOrEqual(3.1);
    expect(response.finalUrl).toBe(response.url);
    const page = iisCards(response.html, {
      origin: new URL(response.url).origin,
      urgid: response.urgid,
      pathStyle: "parts",
    });
    const model = {
      path: new URL(response.url).pathname,
      label: "Captured model",
      count: 3,
    };
    if (index === 0) {
      expect(page.records).toHaveLength(91);
      expect(() =>
        iisValidateModelPage(page, { ...model, count: 91 }),
      ).not.toThrow();
    } else {
      expect(page.nativeEmpty).toBe(true);
      expect(() => iisValidateModelPage(page, model)).toThrow(
        "enumeration is incomplete",
      );
    }
  }
});
