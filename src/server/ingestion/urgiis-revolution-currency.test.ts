import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { z } from "zod";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { iisCards } from "./urgiis-catalog";
import { urgiisDetailSeller } from "./urgiis-detail";
import { iisClass, iisElements, iisText } from "./iis-html";
import { UrgiisReplayArchive } from "./urgiis-replay-archive";
import type { UrgiisRecord } from "./urgiis-schema";
import type { UrgiisTenant } from "./urgiis-tenant";

const fixture = (name: string) =>
  new URL("./urgiis-test-fixtures/" + name, import.meta.url);

test("Revolution currency binds recent native photos to owned donors without purchase dates", async () => {
  const tenant = URGIIS_TENANTS.find(
    (candidate) => candidate.code === "revolution",
  );
  if (!tenant)
    throw new Error("Revolution's qualification contract is missing");
  const proof = z
    .object({
      purchaseDatesPublished: z.literal(false),
      canonicalAvailableDate: z.null(),
      evidence: z
        .array(
          z.object({
            stock: z.string(),
            vin: z.string(),
            year: z.number(),
            modelPage: z.string().url(),
            detailsUrl: z.string().url(),
            photoUrl: z.string().url(),
            photoLastModified: z.string().datetime(),
            retrievedAt: z.string().datetime(),
          }),
        )
        .length(2),
    })
    .parse(
      JSON.parse(readFileSync(fixture("revolution-currency.json"), "utf8")),
    );
  const probes = z
    .object({
      responses: z.array(
        z.object({
          url: z.string().url(),
          html: z.string(),
          status: z.literal(200),
        }),
      ),
      photoReceipts: z.array(
        z.object({
          url: z.string().url(),
          end: z.string().datetime(),
          status: z.literal(200),
          headers: z.object({
            "Last-Modified": z.string(),
            "Content-Type": z.literal("image/jpeg"),
            "Content-Length": z.coerce.number().positive(),
          }),
        }),
      ),
    })
    .parse(
      JSON.parse(
        brotliDecompressSync(
          readFileSync(fixture("revolution-currency-probes.json.br")),
        ).toString(),
      ),
    );
  const records = new Map<string, UrgiisRecord>();
  const archive = await UrgiisReplayArchive.open(tenant.code);
  try {
    while (true) {
      const response = await archive.next();
      if (!response) break;
      const wanted = proof.evidence.filter(
        (evidence) => evidence.modelPage === response.url,
      );
      if (!wanted.length) continue;
      for (const record of iisCards(response.html, tenant).records)
        if (
          record.stock &&
          wanted.some((evidence) => evidence.stock === record.stock)
        )
          records.set(record.stock, record);
    }
  } finally {
    archive.close();
  }
  const sellerContract: UrgiisTenant = {
    ...tenant,
    attribution: {
      kind: "seller",
      additionalYards: [],
      sellerYards: { NC74: tenant.yard.code },
      minimumByYard: { [tenant.yard.code]: 1 },
    },
  };
  for (const evidence of proof.evidence) {
    const record = records.get(evidence.stock);
    expect(record?.vins).toEqual([evidence.vin]);
    expect(record?.years).toEqual([String(evidence.year)]);
    expect(record?.image).toBe(evidence.photoUrl);
    expect(record?.destinations).toEqual([evidence.detailsUrl]);
    expect(record?.date).toBeNull();
    const photo = probes.photoReceipts.find(
      (receipt) => receipt.url === evidence.photoUrl,
    );
    const detail = probes.responses.find(
      (response) => response.url === evidence.detailsUrl,
    );
    if (!photo || !detail)
      throw new Error("Revolution currency evidence lost its native response");
    expect(new Date(photo.headers["Last-Modified"]).toISOString()).toBe(
      evidence.photoLastModified,
    );
    expect(photo.end).toBe(evidence.retrievedAt);
    const age = Date.parse(photo.end) - Date.parse(evidence.photoLastModified);
    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThan(30 * 24 * 60 * 60 * 1000);
    expect(
      urgiisDetailSeller(detail.html, sellerContract, {
        stock: evidence.stock,
        year: String(evidence.year),
        vin: evidence.vin,
      }),
    ).toBe("NC74");
    const vins = iisElements(detail.html, "li", (tag) =>
      iisClass(tag, "iispartpagevin"),
    )
      .map(({ body }) =>
        iisText(body)
          .replace(/^VIN\s*:\s*/i, "")
          .trim(),
      )
      .filter(Boolean);
    expect(vins.length).toBeGreaterThan(0);
    expect([...new Set(vins)]).toEqual([evidence.vin]);
  }
});
