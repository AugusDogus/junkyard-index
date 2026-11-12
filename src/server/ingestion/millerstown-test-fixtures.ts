import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { z } from "zod";

export const MILLERSTOWN_FIXTURE_PDF_URL =
  "http://picapartyard.com/wp-content/uploads/2021/01/2026_04_24-Millerstown-Inventory-2.pdf";
export async function millerstownPdfFixture() {
  const bytes = gunzipSync(
    await readFile(
      new URL("./fixtures/millerstown-inventory.pdf.gz", import.meta.url),
    ),
  );
  if (
    createHash("sha256").update(bytes).digest("hex") !==
    "9e4cd7f6c823648bc7fa18091cb2515c6fffb4c58235fc9be8ae43cbd6f54897"
  )
    throw new Error("Millerstown full binary fixture changed");
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
