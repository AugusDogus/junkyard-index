import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { z } from "zod";

export const MILLERSTOWN_FIXTURE_PDF_URL =
  "http://picapartyard.com/wp-content/uploads/2021/01/2026_11_12-Millerstown-Inventory.pdf";
/**
 * Pages 1-10, 25-27, 35, 40, 44 and 45 of the published 2026-11-12 PDF
 * (sha256 b3bd193f8badc9f2a6ef7746d0dde50e124b8ab06a193eb13658559cf283c1e4) with byte-identical content streams and fonts, plus
 * blank template pages 46-47. Copied with pdf-lib without the tagged structure
 * tree. They cover the sorted header row, a Roboto row, every right-aligned
 * numeric cell, both cross-vehicle VIN conflicts and the last partial page.
 */
export async function millerstownPdfFixture() {
  const bytes = gunzipSync(
    await readFile(
      new URL("./fixtures/millerstown-inventory.pdf.gz", import.meta.url),
    ),
  );
  if (
    createHash("sha256").update(bytes).digest("hex") !==
    "eba6fcf128415160b197bd39f7961dffc706ecdcd3633d6578f01b2a6bd301ed"
  )
    throw new Error("Millerstown trimmed binary fixture changed");
  return bytes;
}
export async function millerstownHtmlFixture(kind: "root" | "inventory") {
  return readFile(
    new URL(`./fixtures/millerstown-${kind}.html`, import.meta.url),
    "utf8",
  );
}
export async function millerstownOracleFixture() {
  const input: unknown = JSON.parse(
    gunzipSync(
      await readFile(
        new URL("./fixtures/millerstown-oracle.json.gz", import.meta.url),
      ),
    ).toString("utf8"),
  );
  const provenance = z
    .object({ page: z.number(), rowOnPage: z.number(), baseline: z.number() })
    .strict();
  return z
    .object({
      rawRecords: z.array(
        z
          .object({
            raw: z
              .object({
                stock: z.string(),
                vin: z.string(),
                type: z.string(),
                make: z.string(),
                model: z.string(),
                year: z.string(),
                color: z.string(),
                trim: z.string(),
                engine: z.string(),
                transmission: z.string(),
                style: z.string(),
              })
              .strict(),
            provenance,
          })
          .strict(),
      ),
      canonical: z.array(
        z
          .object({
            source: z.literal("millerstown"),
            vin: z.string(),
            year: z.number().int(),
            make: z.string(),
            model: z.string(),
            color: z.string().nullable(),
            stockNumber: z.string().nullable(),
            imageUrl: z.string().nullable(),
            availableDate: z.string().nullable(),
            locationCode: z.string(),
            locationName: z.string(),
            locationCity: z.string(),
            state: z.string(),
            stateAbbr: z.string(),
            lat: z.number(),
            lng: z.number(),
            section: z.string().nullable(),
            row: z.string().nullable(),
            space: z.string().nullable(),
            detailsUrl: z.string().nullable(),
            partsUrl: z.string().nullable(),
            pricesUrl: z.string().nullable(),
            engine: z.string().nullable(),
            trim: z.string().nullable(),
            transmission: z.string().nullable(),
          })
          .strict(),
      ),
      rejections: z.array(
        z
          .object({
            provenance,
            vin: z.string().nullable(),
            reasons: z.array(
              z.enum([
                "invalid-native-identity",
                "invalid-source-year",
                "missing-source-make",
                "missing-source-model",
              ]),
            ),
          })
          .strict(),
      ),
      presence: z.array(z.string()),
      rejectedPresence: z.array(z.string()),
    })
    .strict()
    .parse(input);
}
