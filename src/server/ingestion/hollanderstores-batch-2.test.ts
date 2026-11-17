import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  hollanderstoresFixtureBody as body,
  hollanderstoresFixtureBytes as bytes,
  hollanderstoresFixturePages as pages,
  hollanderstoresExpected as expected,
} from "./hollanderstores-test-fixtures";
import { HOLLANDERSTORES_YARDS } from "./hollanderstores-yard-metadata";
import { parseHollanderstoresRoster } from "./hollanderstores-parser";
import { hollanderstoresCensusError } from "./hollanderstores-census";
import {
  HollanderstoresCursor,
  hollanderstoresMissing,
} from "./hollanderstores-cursor";
import { hollanderstoresSeed } from "./hollanderstores-client";
import { hollanderstoresSnapshot } from "./hollanderstores-snapshot";
import { hollanderstoresVin } from "./hollanderstores-vin";
import {
  HOLLANDERSTORES_MAX_BODY_BYTES,
  HOLLANDERSTORES_MAX_CURSOR_BYTES,
  HOLLANDERSTORES_MAX_REQUESTS,
  HOLLANDERSTORES_MAX_ROWS,
} from "./hollanderstores-limits";
import { IngestionSourceFlags } from "./ingestion-source-flags";
import { beaversText } from "./beavers-html";
import { stripInventoryRawText } from "./inventory-html";
import { HollanderstoresDurableCursor } from "./hollanderstores-durable-cursor";
import {
  dehydrateStepReturnValue,
  dehydrateWorkflowReturnValue,
} from "@workflow/core/serialization";

const root = `${import.meta.dir}/hollanderstores-test-fixtures/batch-2/`;
const read = (file: string): unknown =>
  JSON.parse(readFileSync(root + file, "utf8"));
const identity = {
  code: z.string(),
  state: z.string().length(2),
  total: z.number().int().positive(),
};
const candidates = z
  .array(
    z.discriminatedUnion("decision", [
      z.object({
        ...identity,
        decision: z.literal("qualified"),
        accepted: z.number().int().positive(),
        rejected: z.number().int().nonnegative(),
        currency: z.object({
          maxRecordId: z.number().int(),
          recordsSince2026: z.number().int().positive(),
        }),
      }),
      z.object({
        ...identity,
        decision: z.literal("excluded"),
        reason: z.string().min(1),
      }),
    ]),
  )
  .parse(read("candidates.json"));
const receipts = z
  .array(
    z.object({
      url: z.string().url(),
      file: z.string(),
      body: z.string().nullable(),
      capturedAt: z.string().datetime(),
      completedAt: z.string().datetime(),
      bytes: z.number().optional(),
      sha256: z.string().optional(),
      status: z.number().optional(),
    }),
  )
  .parse(read("requests.json"));
const codes = new Set(candidates.map((candidate) => candidate.code));

const wellerTemplate = HOLLANDERSTORES_YARDS[0];
if (!wellerTemplate) throw new Error("Missing Hollander yard template");
const wellerResearchYard = {
  ...wellerTemplate,
  code: "wellerauto",
  tenant: "2561",
  logo: "Weller Auto Parts",
  websiteUrl: "https://wellerauto.hollanderstores.com/",
};

test("Weller's shared tenant is excluded because the saved rosters cannot attribute vehicles to a physical yard", () => {
  for (const file of ["wellerauto.html.gz", "wellerauto-closing.html.gz"]) {
    const raw = body("batch-2/" + file);
    const roster = parseHollanderstoresRoster(raw, wellerResearchYard);
    expect(roster.total).toBe(2192);
    expect(
      roster.rows.every((row) =>
        new URL(row.url).pathname.startsWith("/VehicleDealerShowParts/2561/"),
      ),
    ).toBe(true);
    // The entire saved response, including scripts and hidden inputs, has no
    // location field. Stock numbers have no verified location mapping.
    expect(raw).not.toMatch(
      /Kalamazoo|Grand Rapids|Chicago|(?:name|id)=["'][^"']*(?:location|branch|address|yardId|storeId)/i,
    );
  }
  expect(
    new Set<string>(HOLLANDERSTORES_YARDS.map((yard) => yard.code)).has(
      "wellerauto",
    ),
  ).toBe(false);
  expect(
    candidates.find((candidate) => candidate.code === "wellerauto"),
  ).toMatchObject({
    decision: "excluded",
    reason: expect.stringContaining("per-vehicle location"),
  });
});

test("Stricker parses both complete matching censuses with its bounded tenant exception", () => {
  const yard = HOLLANDERSTORES_YARDS.find(
    (yard) => yard.code === "strickerauto",
  );
  if (!yard) throw new Error("Missing qualified Stricker yard");
  const captures = ["strickerauto.html.gz", "strickerauto-closing.html.gz"].map(
    (file) => {
      const raw = body("batch-2/" + file);
      expect(Buffer.byteLength(raw)).toBeGreaterThan(
        HOLLANDERSTORES_MAX_BODY_BYTES,
      );
      expect(raw.trimEnd()).toEndWith("</html>");
      const total = Number(
        /Showing (\d+) Vehicles in Inventory/.exec(raw)?.[1],
      );
      const destinations = [
        ...raw.matchAll(
          /href="(\/VehicleDealerShowParts\/2364\/[1-9][0-9]*)"/g,
        ),
      ].map((match) => match[1]);
      expect(total).toBe(12456);
      expect(raw.match(/<div class="individualPartHolder"/g)).toHaveLength(
        total,
      );
      expect(destinations).toHaveLength(total);
      expect(new Set(destinations).size).toBe(total);
      expect(parseHollanderstoresRoster(raw, yard).rows).toHaveLength(total);
      return destinations;
    },
  );
  expect(captures[0]).toEqual(captures[1]);
}, 30000);

test("batch two qualifies each complete tenant independently and leaves exclusions and Shroyer unconfigured", () => {
  expect(candidates).toHaveLength(18);
  expect(codes.size).toBe(18);
  expect(
    new Set<string>(HOLLANDERSTORES_YARDS.map((yard) => yard.code)).has(
      "shroyerauto",
    ),
  ).toBe(false);
  const snapshot = hollanderstoresSnapshot(pages(), hollanderstoresSeed);
  expect(snapshot.errors).toEqual([]);
  for (const candidate of candidates) {
    const yard = HOLLANDERSTORES_YARDS.find(
      (yard) => yard.code === candidate.code,
    );
    if (candidate.decision === "excluded") {
      // Stricker was qualified separately after this historical batch.
      if (candidate.code === "strickerauto") continue;
      expect(yard).toBeUndefined();
      continue;
    }
    if (!yard) throw new Error("Qualified tenant missing: " + candidate.code);
    expect(candidate.state).toBe(yard.state);
    expect(Math.max(1, Math.floor(candidate.accepted / 3))).toBe(yard.minimum);
    const opening = parseHollanderstoresRoster(
      body(`batch-2/${yard.code}.html.gz`),
      yard,
    );
    const closing = parseHollanderstoresRoster(
      body(`batch-2/${yard.code}-closing.html.gz`),
      yard,
    );
    expect(hollanderstoresCensusError(opening, closing)).toBeNull();
    expect(opening.total).toBe(candidate.total);
    expect(candidate.accepted + candidate.rejected).toBe(candidate.total);
    expect(candidate.rejected / candidate.total).toBeLessThan(0.09);
    expect(
      snapshot.perYard.find((row) => row.code === yard.code),
    ).toMatchObject({
      total: candidate.total,
      accepted: candidate.accepted,
      rejected: candidate.rejected,
    });
    const ids = opening.rows.map((row) =>
      Number(new URL(row.url).pathname.split("/").at(-1)),
    );
    expect(Math.max(...ids)).toBe(candidate.currency.maxRecordId);
    expect(ids.filter((id) => id >= 70_870_000).length).toBe(
      candidate.currency.recordsSince2026,
    );
    expect(
      snapshot.vehicles
        .filter((vehicle) => vehicle.locationCode === yard.code)
        .every((vehicle) => vehicle.availableDate === null),
    ).toBe(true);
  }
  expect(IngestionSourceFlags.resolve({})).toContain("hollanderstores");
}, 30000);

test("batch two response receipts prove serial spaced requests and exact replay bytes", () => {
  for (const [index, receipt] of receipts.entries()) {
    const previous = receipts[index - 1];
    if (previous)
      expect(
        Date.parse(receipt.capturedAt) - Date.parse(previous.completedAt),
      ).toBeGreaterThanOrEqual(3000);
    if (receipt.bytes === undefined || !receipt.sha256) continue;
    const raw = bytes("batch-2/" + receipt.file);
    expect(raw.byteLength).toBe(receipt.bytes);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(receipt.sha256);
  }
}, 30000);

test("batch two physical locations match published addresses and exact Census or business markers", () => {
  const location = {
    code: z.string(),
    address: z.string(),
    publishedAddress: z.string(),
    city: z.string(),
    state: z.string(),
    postalCode: z.string(),
    lat: z.number(),
    lng: z.number(),
    coordinateFile: z.string(),
  };
  const locations = z
    .array(
      z.discriminatedUnion("provider", [
        z.object({ ...location, provider: z.literal("census") }),
        z.object({
          ...location,
          provider: z.literal("google-business-marker"),
          markerAddress: z.string(),
          addressFile: z.string(),
        }),
      ]),
    )
    .parse(read("locations.json"));
  for (const yard of HOLLANDERSTORES_YARDS.filter(
    (yard) => codes.has(yard.code) && yard.code !== "strickerauto",
  )) {
    const location = locations.find((row) => row.code === yard.code);
    if (!location) throw new Error("Missing coordinate evidence: " + yard.code);
    expect(location).toMatchObject({
      code: yard.code,
      address: yard.address,
      city: yard.city,
      state: yard.state,
      postalCode: yard.postalCode,
      lat: yard.lat,
      lng: yard.lng,
    });
    if (location.provider === "google-business-marker") {
      const markers = [
        ...body("batch-2/" + location.coordinateFile).matchAll(
          /"([^"\n]+)",\[(-?[\d.]+),(-?[\d.]+)\]/g,
        ),
      ];
      expect(
        markers.some(
          (marker) =>
            JSON.parse('"' + marker[1] + '"') === location.markerAddress &&
            Number(marker[2]) === yard.lat &&
            Number(marker[3]) === yard.lng,
        ),
      ).toBe(true);
      expect(location.markerAddress).toContain(yard.postalCode);
      expect(body("batch-2/" + location.addressFile)).toContain(
        yard.postalCode,
      );
    } else {
      const response = z
        .object({
          result: z.object({
            addressMatches: z
              .array(
                z.object({
                  coordinates: z.object({ x: z.number(), y: z.number() }),
                  addressComponents: z.object({
                    state: z.string(),
                    zip: z.string(),
                  }),
                }),
              )
              .min(1),
          }),
        })
        .parse(JSON.parse(body("batch-2/" + location.coordinateFile)));
      expect(
        response.result.addressMatches.some(
          (match) =>
            match.coordinates.x === yard.lng &&
            match.coordinates.y === yard.lat &&
            match.addressComponents.state === yard.state &&
            match.addressComponents.zip === yard.postalCode,
        ),
      ).toBe(true);
    }
    const about = body(`batch-2/${yard.code}-about.html.gz`);
    expect(about).toContain(yard.postalCode);
    expect(beaversText(stripInventoryRawText(about))).toContain(
      location.publishedAddress,
    );
    expect(yard.address).not.toMatch(/\b(?:PO|P\.?O\.?)\s*BOX\b/i);
  }
});

test("batch two vPIC receipts decode exactly the new valid VINs with missing native makes", () => {
  const previous = new Set(
    Object.keys(
      z
        .record(z.object({ Make: z.string() }))
        .parse(JSON.parse(body("vpic-audit.json.gz"))),
    ),
  );
  for (const directory of ["expansion", "pauls"]) {
    const earlier = z
      .array(
        z.object({
          url: z.string(),
          file: z.string(),
          error: z.string().optional(),
        }),
      )
      .parse(
        JSON.parse(
          readFileSync(root + "../" + directory + "/requests.json", "utf8"),
        ),
      );
    for (const receipt of earlier.filter(
      (receipt) => receipt.url.includes("vpic.nhtsa.dot.gov") && !receipt.error,
    )) {
      const response = z
        .object({
          Results: z.array(
            z.object({ VIN: z.string(), Make: z.string().nullable() }),
          ),
        })
        .parse(JSON.parse(body(directory + "/" + receipt.file)));
      for (const row of response.Results)
        if (
          row.Make?.trim() &&
          !/^(?:unknown|none|other|n\/?a|null|0+)$/i.test(row.Make.trim())
        )
          previous.add(row.VIN);
    }
  }
  const needed = new Set(
    hollanderstoresMissing({
      // Audit membership reflects the original requests, including Weller's
      // subsequently excluded roster. Retain every original receipt.
      pages: [
        ...pages().filter(
          (page) => codes.has(page.yard) && page.yard !== "strickerauto",
        ),
        parseHollanderstoresRoster(
          body("batch-2/wellerauto.html.gz"),
          wellerResearchYard,
        ),
      ],
    }).filter((vin) => !previous.has(vin)),
  );
  const audited = new Set<string>();
  for (const receipt of receipts.filter(
    (receipt) =>
      receipt.url.includes("vpic.nhtsa.dot.gov") && receipt.status === 200,
  )) {
    const requested =
      new URLSearchParams(receipt.body ?? "").get("data")?.split(";") ?? [];
    const response = z
      .object({
        Count: z.number(),
        Results: z
          .array(z.object({ VIN: z.string(), Make: z.string().nullable() }))
          .min(1)
          .max(50),
      })
      .parse(JSON.parse(body("batch-2/" + receipt.file)));
    expect(response.Count).toBe(requested.length);
    expect(response.Results.map((row) => row.VIN).sort()).toEqual(
      [...requested].sort(),
    );
    expect(new Set(requested).size).toBe(requested.length);
    for (const row of response.Results) {
      expect(hollanderstoresVin(row.VIN)).toBe(row.VIN);
      expect(needed.has(row.VIN)).toBe(true);
      expect(audited.has(row.VIN)).toBe(false);
      audited.add(row.VIN);
      const make = row.Make?.trim();
      if (make && !/^(?:unknown|none|other|n\/?a|null|0+)$/i.test(make))
        expect(hollanderstoresSeed[row.VIN]).toBe(make);
      else expect(hollanderstoresSeed[row.VIN]).toBeUndefined();
    }
  }
  expect([...audited].sort()).toEqual([...needed].sort());
}, 30000);

test("expanded daily census remains inside row, cursor and logical operation budgets", async () => {
  const opening = pages();
  const needed = hollanderstoresMissing({ pages: opening });
  const requests = opening.length * 2 + Math.ceil(needed.length / 50);
  const initial = HollanderstoresCursor.initial();
  const cursor = HollanderstoresCursor.checkpoint({
    source: initial.source,
    version: initial.version,
    scope: initial.scope,
    previousAcceptedCount: null,
    pending: null,
    phase: "complete",
    startedAt: Date.now(),
    pages: opening,
    decoded: Object.fromEntries(
      needed.map((vin) => [vin, hollanderstoresSeed[vin] ?? null]),
    ),
    requests,
    closed: opening.length,
  });
  expect(opening.reduce((sum, page) => sum + page.total, 0)).toBeLessThan(
    HOLLANDERSTORES_MAX_ROWS,
  );
  expect(requests).toBeLessThan(HOLLANDERSTORES_MAX_REQUESTS);
  expect(
    Buffer.byteLength(HollanderstoresCursor.serialize(cursor)),
  ).toBeLessThan(HOLLANDERSTORES_MAX_CURSOR_BYTES);
  // Even the full expanded census crosses workflow boundaries only as a
  // reference. Bound the real codecs with a maximum-length blob pathname.
  const reference = {
    ...HollanderstoresDurableCursor.checkpoint(cursor),
    statePath: "x".repeat(256),
  };
  const rows = opening.reduce((sum, page) => sum + page.total, 0);
  const output = {
    cursor: reference,
    status: "complete",
    count: rows,
    uniqueVehicles: expected.count,
    duplicateVehicles: 0,
    rejectedVehicles: rows - expected.count,
    pagesProcessed: requests,
    errors: [],
  };
  expect(Buffer.byteLength(JSON.stringify(reference))).toBeLessThan(2048);
  for (const payload of [
    await dehydrateStepReturnValue(output, "offline", undefined),
    await dehydrateWorkflowReturnValue(
      ["offline", reference],
      "offline",
      undefined,
    ),
  ]) {
    if (!(payload instanceof Uint8Array))
      throw new Error("Expected binary workflow payload");
    expect(payload.byteLength).toBeLessThan(2048);
  }
}, 30000);
