import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import { createHash } from "node:crypto";
import { stripInventoryRawText } from "./inventory-html";
import { iisDocument, iisCards } from "./urgiis-catalog";
import { iisAttribute, iisClass, iisElements } from "./iis-html";
import { z } from "zod";
import {
  URGIIS_CUT_TENANTS,
  URGIIS_MINIMUM_BY_YARD,
  URGIIS_TENANTS,
} from "./urgiis-configuration";

const accounting = {
  accepted: z.number().int().positive(),
  recordsProcessed: z.number().int().positive(),
  recordsExcluded: z.number().int().nonnegative(),
  recordsRejected: z.number().int().nonnegative(),
  duplicateVehicles: z.number().int().nonnegative(),
};
const common = {
  code: z.string(),
  name: z.string(),
  urgid: z.string(),
  requests: z.number().int().positive(),
};
const summary = z
  .object({
    requests: z.number().int().positive(),
    knownUnloggedAttempts: z.literal(0),
    tenants: z.array(
      z.discriminatedUnion("outcome", [
        z.object({
          ...common,
          ...accounting,
          outcome: z.literal("qualified"),
          minimumInventory: z.number().int().positive(),
          makes: z.number().int().positive(),
          models: z.number().int().positive(),
          closed: z.number().int().positive(),
          drift: z.object({ makes: z.number(), models: z.number() }),
          rejectionPercent: z.number(),
        }),
        z.object({
          ...common,
          outcome: z.literal("excluded"),
          failure: z.object({ error: z.string().min(1) }),
        }),
      ]),
    ),
    audit: z.object({
      sourceFloor: z.number(),
      bounds: z.array(
        z.object({
          yard: z.string(),
          accepted: z.number(),
          maximumDuplicateLoss: z.number(),
          conservativeRemaining: z.number(),
          floor: z.number(),
        }),
      ),
    }),
    fullCensusBudget: z.object({
      nativeRequests: z.number(),
      responseBytes: z.number(),
    }),
  })
  .parse(
    JSON.parse(
      readFileSync(
        new URL(
          "./urgiis-test-fixtures/fresh-census-qualification.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
const receipts = gunzipSync(
  readFileSync(
    new URL(
      "./urgiis-test-fixtures/fresh-census-requests.jsonl.gz",
      import.meta.url,
    ),
  ),
)
  .toString()
  .trim()
  .split("\n")
  .map((line) =>
    z
      .object({
        tenant: z.string(),
        url: z.string().url(),
        label: z.string(),
        mode: z.enum(["browser", "firefox"]),
        startedAt: z.number(),
        endedAt: z.number(),
        status: z.number(),
        exit: z.number(),
        sharedGate: z.literal(true),
        sha256: z.string().length(64).nullable(),
      })
      .parse(JSON.parse(line)),
  );

test("fresh URG qualification records every attempt and preserves the one shared 3.1-second gate", () => {
  expect(receipts).toHaveLength(summary.requests);
  for (let index = 1; index < receipts.length; index++) {
    const before = receipts[index - 1];
    const after = receipts[index];
    if (!before || !after)
      throw new Error("Missing consecutive request receipt");
    expect(after.startedAt - before.startedAt).toBeGreaterThanOrEqual(3.1);
  }
  const urg = receipts.filter((receipt) => receipt.tenant !== "ifipull");
  for (const receipt of urg) {
    const active = urg.filter(
      (other) =>
        other.startedAt <= receipt.startedAt &&
        other.endedAt > receipt.startedAt,
    );
    expect(active.length).toBeLessThanOrEqual(3);
    expect(new Set(active.map((other) => other.tenant)).size).toBe(
      active.length,
    );
  }
  for (const yard of summary.tenants) {
    const own = receipts.filter((receipt) => receipt.tenant === yard.code);
    expect(own).toHaveLength(yard.requests);
    for (let index = 1; index < own.length; index++) {
      const before = own[index - 1];
      const after = own[index];
      if (!before || !after)
        throw new Error("Missing consecutive tenant receipt");
      expect(after.startedAt - before.endedAt).toBeGreaterThanOrEqual(3.1);
    }
    if (yard.code === "mars")
      expect(own.every((receipt) => receipt.mode === "firefox")).toBe(true);
  }
});

for (const yard of summary.tenants)
  test(`${yard.name}'s fresh qualification agrees with its admission contract`, () => {
    const tenant = URGIIS_TENANTS.find((tenant) => tenant.code === yard.code);
    if (URGIIS_CUT_TENANTS.has(yard.code)) {
      // Qualified here, then cut by the owner; it never published.
      expect(tenant).toBeUndefined();
      return;
    }
    if (yard.outcome === "excluded") {
      expect(tenant).toBeUndefined();
      expect(yard.failure.error).not.toBe("");
      return;
    }
    if (!tenant) throw new Error("Qualified tenant is missing: " + yard.code);
    expect(tenant.urgid).toBe(yard.urgid);
    expect(tenant.photoCodes).toEqual([yard.urgid.toLowerCase()]);
    expect(tenant.minimumInventory).toBe(Math.floor(yard.accepted / 3));
    expect(yard.minimumInventory).toBe(tenant.minimumInventory);
    expect(yard.closed).toBe(yard.makes + 2);
    expect(yard.rejectionPercent).toBeLessThan(9.5);
    expect(yard.accepted + yard.recordsRejected + yard.duplicateVehicles).toBe(
      yard.recordsProcessed - yard.recordsExcluded,
    );
    const requests = receipts.filter(
      (receipt) =>
        receipt.tenant === yard.code &&
        receipt.status === 200 &&
        receipt.exit === 0,
    );
    const finalOpening = requests
      .filter((receipt) => receipt.label.startsWith("opening-"))
      .at(-1);
    const closing = requests.filter((receipt) =>
      receipt.label.startsWith("closing-"),
    );
    if (!finalOpening) throw new Error("Missing opening census receipt");
    expect(closing).toHaveLength(yard.closed);
    expect(
      closing.every((receipt) => receipt.startedAt > finalOpening.endedAt),
    ).toBe(true);
  });

test("fresh URG admitted censuses retain own supplier photographs and avoid 500/30-card truncation", () => {
  const proofs = z
    .array(
      z.object({
        code: z.string(),
        makes: z.number(),
        models: z.number(),
        maximumModelCards: z.number(),
        thirtyCardModels: z.array(
          z.object({ url: z.string().url(), advertised: z.number() }),
        ),
        photos: z.record(z.number()),
      }),
    )
    .parse(
      JSON.parse(
        readFileSync(
          new URL(
            "./urgiis-test-fixtures/fresh-census-cap-photo.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
  expect(proofs).toHaveLength(
    summary.tenants.filter((tenant) => tenant.outcome === "qualified").length,
  );
  for (const proof of proofs) {
    const yard = summary.tenants.find((tenant) => tenant.code === proof.code);
    if (!yard || yard.outcome !== "qualified")
      throw new Error("Unadmitted census proof");
    expect(proof.makes).toBe(yard.makes);
    expect(proof.models).toBe(yard.models);
    expect(proof.maximumModelCards).toBeLessThan(500);
    expect(
      proof.thirtyCardModels.every((model) => model.advertised <= 30),
    ).toBe(true);
    expect(Object.keys(proof.photos)).toEqual([yard.urgid.toLowerCase()]);
  }
});

test("fresh URG qualification keeps each physical yard above its floor after conservative deduplication", () => {
  // This receipt predates sibling batches. Check its own scope, then apply
  // today's per-yard policy without treating the receipt as a whole-source audit.
  expect(summary.audit.sourceFloor).toBe(
    summary.audit.bounds.reduce((total, bound) => total + bound.floor, 0),
  );
  const cutYards = new Set([...URGIIS_CUT_TENANTS.values()].flat());
  for (const bound of summary.audit.bounds) {
    if (cutYards.has(bound.yard)) continue;
    const minimum = URGIIS_MINIMUM_BY_YARD.get(bound.yard);
    if (minimum === undefined)
      throw new Error(`Missing URG yard ${bound.yard}`);
    expect(minimum).toBeLessThanOrEqual(bound.floor);
    expect(bound.conservativeRemaining).toBeGreaterThanOrEqual(minimum);
  }
  expect(
    summary.audit.bounds.every(
      (bound) =>
        bound.conservativeRemaining >= bound.floor &&
        bound.accepted - bound.maximumDuplicateLoss ===
          bound.conservativeRemaining,
    ),
  ).toBe(true);
  expect(summary.fullCensusBudget.nativeRequests).toBeLessThanOrEqual(30000);
  expect(summary.fullCensusBudget.responseBytes).toBeLessThanOrEqual(
    8 * 1024 ** 3,
  );
});

test("Norb's only qualified bins hold parts across unrelated makes and years without native donor VINs", () => {
  const tenant = URGIIS_TENANTS.find((tenant) => tenant.code === "norbs");
  if (!tenant) throw new Error("Missing qualified Norb's contract");
  expect(tenant.placeholderStocks).toEqual(["NOR6", "NOF"]);
  const proofs = z
    .array(
      z.object({ stock: z.string(), url: z.string().url(), html: z.string() }),
    )
    .parse(
      JSON.parse(
        brotliDecompressSync(
          readFileSync(
            new URL(
              "./urgiis-test-fixtures/fresh-census-bin-proofs.json.br",
              import.meta.url,
            ),
          ),
        ).toString(),
      ),
    );
  expect(proofs).toHaveLength(4);
  for (const stock of tenant.placeholderStocks) {
    const own = proofs.filter((proof) => proof.stock === stock);
    expect(own).toHaveLength(2);
    expect(new Set(own.map((proof) => proof.url)).size).toBe(2);
    for (const proof of own) {
      const receipt = receipts.find(
        (receipt) =>
          receipt.tenant === "norbs" &&
          receipt.url === proof.url &&
          receipt.label.startsWith("bin-proof-"),
      );
      if (!receipt || receipt.sha256 === null)
        throw new Error("Missing counted and hashed native bin proof request");
      expect(receipt.status).toBe(200);
      expect(receipt.exit).toBe(0);
      expect(createHash("sha256").update(proof.html).digest("hex")).toBe(
        receipt.sha256,
      );
      const html = iisDocument(proof.html, tenant);
      const values = (name: string) =>
        [...html.matchAll(/<input\b[^>]*>/gi)].flatMap(([tag]) =>
          iisAttribute(tag, "name") === name
            ? [iisAttribute(tag, "value") ?? ""]
            : [],
        );
      const stocks = values("stockno");
      expect(stocks.length).toBeGreaterThanOrEqual(2);
      expect(stocks.every((value) => value === stock)).toBe(true);
      expect(
        new Set(values("make").filter(Boolean)).size,
      ).toBeGreaterThanOrEqual(2);
      expect(
        new Set(
          values("yearin").filter((value) => value !== "" && value !== "0"),
        ).size,
      ).toBeGreaterThanOrEqual(2);
      expect(
        iisElements(html, "li", (tag) => iisClass(tag, "iis-lisku")).length,
      ).toBeGreaterThanOrEqual(2);
      expect(
        iisElements(html, "li", (tag) => iisClass(tag, "iispartpagevin")),
      ).toHaveLength(0);
    }
  }
});

test("Lake Point's newly observed arrival bundle is an exact verified UU23 literal", () => {
  const proof = z
    .object({
      url: z.string().url(),
      script: z.string(),
      initialFailure: z.object({ error: z.string() }),
      initialResponses: z.array(
        z.object({ url: z.string().url(), html: z.string() }),
      ),
    })
    .parse(
      JSON.parse(
        brotliDecompressSync(
          readFileSync(
            new URL(
              "./urgiis-test-fixtures/lakepoint-fresh-supplier-bundle.json.br",
              import.meta.url,
            ),
          ),
        ).toString(),
      ),
    );
  const hash = "2c733cc353e1f69c742a7aee3ce9bb31";
  expect(proof.url).toBe(
    "https://lakepointauto.com/wp-content/litespeed/js/" +
      hash +
      ".js?ver=9a323",
  );
  expect(createHash("md5").update(proof.script).digest("hex")).toBe(hash);
  const suppliers = [
    ...proof.script.matchAll(/\bvar\s+urgid\s*=\s*(['"])(.*?)\1\s*;/g),
  ].map((match) => match[2]);
  const homes = [
    ...proof.script.matchAll(/\biisHomeUrl\s*=\s*(['"])(.*?)\1/g),
  ].map((match) => match[2]);
  expect(suppliers.length).toBeGreaterThan(0);
  expect(suppliers.every((supplier) => supplier === "UU23")).toBe(true);
  expect(homes.length).toBeGreaterThan(0);
  expect(homes.every((home) => home === "lakepointauto.com")).toBe(true);
  expect(proof.initialFailure.error).toContain("supplier identity changed");
  const arrivals = proof.initialResponses.find(
    (response) => response.url === "https://lakepointauto.com/latest-arrivals/",
  );
  if (!arrivals)
    throw new Error(
      "Missing captured arrival page for the new supplier literal",
    );
  const site = {
    origin: "https://lakepointauto.com",
    urgid: "UU23",
    pathStyle: "parts",
  } as const;
  expect(
    iisCards(arrivals.html, site, "arrivals").records.length,
  ).toBeGreaterThan(0);
  expect(() =>
    iisDocument(
      arrivals.html.replaceAll(hash, "00000000000000000000000000000000"),
      site,
    ),
  ).toThrow("supplier identity changed");
  expect(() =>
    iisDocument(
      arrivals.html.replaceAll(".js?ver=9a323", ".js?ver=unverified"),
      site,
    ),
  ).toThrow("supplier identity changed");
});

test("Lake Point's NOF proof independently binds its native parts and exact supplier assets", () => {
  const proofs = z
    .array(
      z.object({
        stock: z.literal("NOF"),
        url: z.string().url(),
        html: z.string(),
        supplierBundle: z.object({ url: z.string().url(), script: z.string() }),
      }),
    )
    .parse(
      JSON.parse(
        brotliDecompressSync(
          readFileSync(
            new URL(
              "./urgiis-test-fixtures/lakepoint-bin-proofs.json.br",
              import.meta.url,
            ),
          ),
        ).toString(),
      ),
    );
  expect(proofs).toHaveLength(2);
  expect(new Set(proofs.map((proof) => proof.url)).size).toBe(2);
  const tenant = URGIIS_TENANTS.find((tenant) => tenant.code === "lakepoint");
  if (tenant) expect(tenant.placeholderStocks).toEqual(["NOF"]);
  for (const proof of proofs) {
    expect(new URL(proof.url).origin).toBe("https://lakepointauto.com");
    expect(proof.url).toContain("/NOF/");
    const bundle = proof.supplierBundle;
    expect(bundle.url).toBe(
      "https://lakepointauto.com/wp-content/litespeed/js/" +
        createHash("md5").update(bundle.script).digest("hex") +
        ".js?ver=9a323",
    );
    const scripts = [...proof.html.matchAll(/<script\b[^>]*>/gi)]
      .map(([tag]) => tag)
      .filter((tag) => iisAttribute(tag, "data-optimized") === "1");
    expect(scripts).toHaveLength(1);
    expect(iisAttribute(scripts[0] ?? "", "data-src")).toBe(bundle.url);
    const ids = [
      ...bundle.script.matchAll(/\bvar\s+urgid\s*=\s*(['"])(.*?)\1\s*;/g),
    ].map((match) => match[2]);
    const homes = [
      ...bundle.script.matchAll(/\biisHomeUrl\s*=\s*(['"])(.*?)\1/g),
    ].map((match) => match[2]);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id === "UU23")).toBe(true);
    expect(homes.length).toBeGreaterThan(0);
    expect(homes.every((home) => home === "lakepointauto.com")).toBe(true);
    for (const response of [
      { url: proof.url, body: proof.html },
      { url: bundle.url, body: bundle.script },
    ]) {
      const receipt = receipts.find(
        (receipt) =>
          receipt.tenant === "lakepoint" && receipt.url === response.url,
      );
      if (!receipt || receipt.sha256 === null)
        throw new Error("Missing counted and hashed Lake Point proof request");
      expect(receipt.status).toBe(200);
      expect(receipt.exit).toBe(0);
      expect(createHash("sha256").update(response.body).digest("hex")).toBe(
        receipt.sha256,
      );
    }
    const html = stripInventoryRawText(proof.html);
    expect(Buffer.byteLength(proof.html)).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(html).toMatch(/<\/body\s*>\s*<\/html\s*>\s*$/i);
    const values = (name: string) =>
      [...html.matchAll(/<input\b[^>]*>/gi)].flatMap(([tag]) =>
        iisAttribute(tag, "name") === name
          ? [iisAttribute(tag, "value") ?? ""]
          : [],
      );
    expect(values("stockno").length).toBeGreaterThanOrEqual(2);
    expect(values("stockno").every((stock) => stock === "NOF")).toBe(true);
    expect(new Set(values("make").filter(Boolean)).size).toBeGreaterThanOrEqual(
      2,
    );
    expect(
      new Set(values("yearin").filter((year) => year !== "" && year !== "0"))
        .size,
    ).toBeGreaterThanOrEqual(2);
    expect(values("vin").every((vin) => vin.trim() === "")).toBe(true);
    expect(
      iisElements(html, "li", (tag) => iisClass(tag, "iis-lisku")).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      iisElements(html, "li", (tag) => iisClass(tag, "iispartpagevin")),
    ).toHaveLength(0);
  }
});
