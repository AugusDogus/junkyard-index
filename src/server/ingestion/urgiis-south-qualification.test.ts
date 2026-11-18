import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { UrgiisReplayArchive } from "./urgiis-replay-archive";
import { validateUrgiisSnapshot } from "./urgiis-snapshot";
import { iisDirectory } from "./urgiis-catalog";
import type { UrgiisControl } from "./urgiis-schema";
import qualification from "./urgiis-test-fixtures/south-qualification.json";
import geocode from "./urgiis-test-fixtures/stroud-geocode.json";

const receiptsSchema = z.array(
  z
    .object({
      url: z.string().url(),
      requestUrl: z.string().url(),
      status: z.literal(200),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z
        .number()
        .int()
        .positive()
        .max(4 * 1024 * 1024),
      completedAt: z.number().positive(),
      timing: z.discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("measured"),
            requestStarted: z.number().positive(),
            gateWaitSeconds: z.number().nonnegative(),
          })
          .strict(),
        z.object({ kind: z.literal("completion-only") }).strict(),
      ]),
    })
    .strict(),
);

for (const proof of qualification.outcomes) {
  const tenant = URGIIS_TENANTS.find((t) => t.code === proof.tenant);
  if (!tenant) throw new Error(`Missing southern URG tenant ${proof.tenant}`);

  test(`${tenant.yard.name} retains a recent accepted donor and a one-third floor`, async () => {
    const snapshot = await UrgiisReplayArchive.assess(tenant.code, tenant);
    validateUrgiisSnapshot(snapshot, tenant);
    expect(snapshot.vehicles).toHaveLength(proof.accepted);
    expect(snapshot.accounting).toEqual(proof.accounting);
    expect(tenant.minimumInventory).toBe(Math.floor(proof.accepted / 3));
    expect(tenant.skipBlankVin).toBe(false);
    expect(tenant.placeholderStocks).toEqual([]);
    const latest = snapshot.vehicles.reduce(
      (date, donor) =>
        donor.availableDate && donor.availableDate > date
          ? donor.availableDate
          : date,
      "",
    );
    expect(latest).toBe(proof.latestDate);
    const age = Date.parse(proof.capturedOn) - Date.parse(latest);
    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThanOrEqual(60 * 24 * 60 * 60 * 1000);
    expect(
      snapshot.vehicles.find((v) => v.vin === proof.latestVin),
    ).toMatchObject({
      availableDate: latest,
      stateAbbr: proof.state,
      locationCode: tenant.yard.code,
      lat: tenant.yard.lat,
      lng: tenant.yard.lng,
    });
  }, 120_000);

  test(`${tenant.yard.name} preserves separately timed native opening and closing responses`, async () => {
    const receipts = receiptsSchema.parse(
      JSON.parse(
        gunzipSync(
          readFileSync(
            new URL(
              `./urgiis-test-fixtures/${tenant.code}-south-receipts.json.gz`,
              import.meta.url,
            ),
          ),
        ).toString(),
      ),
    );
    const archive = await UrgiisReplayArchive.open(tenant.code);
    try {
      expect(receipts).toHaveLength(proof.requests);
      expect(
        receipts.filter((r) => r.timing.kind === "completion-only"),
      ).toHaveLength(proof.completionOnlyRequests);
      expect(archive.responseCount).toBe(proof.requests);
      const closingAt = receipts.findIndex(
        (r, i) => i > 0 && r.url === receipts[0]?.url,
      );
      expect(closingAt).toBeGreaterThan(0);
      const finalOpening = receipts[closingAt - 1];
      if (!finalOpening) throw new Error("Missing final opening response");
      const makes = new Map<string, UrgiisControl>();
      const directories = new Map<string, UrgiisControl[]>();
      let closedDirectories = 0;
      for (const [index, receipt] of receipts.entries()) {
        const response = await archive.next();
        if (!response) throw new Error(`Missing native response ${index}`);
        expect(response.url).toBe(receipt.url);
        expect(receipt.requestUrl).toBe(
          response.url.replaceAll("(", "%28").replaceAll(")", "%29"),
        );
        expect(Buffer.byteLength(response.html)).toBe(receipt.bytes);
        expect(createHash("sha256").update(response.html).digest("hex")).toBe(
          receipt.sha256,
        );
        const previous = receipts[index - 1];
        if (receipt.timing.kind === "measured") {
          expect(receipt.completedAt).toBeGreaterThanOrEqual(
            receipt.timing.requestStarted,
          );
          if (previous)
            expect(
              receipt.timing.requestStarted - previous.completedAt,
            ).toBeGreaterThanOrEqual(2.99);
        }
        if (index >= closingAt) {
          if (receipt.timing.kind !== "measured")
            throw new Error("Closing request has no measured start");
          expect(receipt.timing.requestStarted).toBeGreaterThan(
            finalOpening.completedAt,
          );
        }
        const path = new URL(response.url).pathname;
        const make = makes.get(path);
        if (path === tenant.makesPath || make) {
          const controls = iisDirectory(response.html, tenant, make);
          const opening = directories.get(path);
          if (opening) {
            expect(controls).toEqual(opening);
            closedDirectories++;
          } else directories.set(path, controls);
          if (path === tenant.makesPath)
            for (const control of controls) makes.set(control.path, control);
        }
      }
      expect(makes.size).toBe(proof.makes);
      expect(closedDirectories).toBe(proof.makes + 1);
      expect(await archive.next()).toBeUndefined();
    } finally {
      archive.close();
    }
  }, 60_000);
}

test("Stroud's yard coordinates retain the Census street-address match", () => {
  const tenant = URGIIS_TENANTS.find((t) => t.code === "stroud");
  const match = geocode.result.addressMatches[0];
  if (!tenant || !match)
    throw new Error("Missing Stroud yard/geocode evidence");
  expect(match.matchedAddress).toBe(
    "6118 STATE HWY 96, YOUNGSVILLE, NC, 27596",
  );
  expect(tenant.yard.lat).toBe(match.coordinates.y);
  expect(tenant.yard.lng).toBe(match.coordinates.x);
});
