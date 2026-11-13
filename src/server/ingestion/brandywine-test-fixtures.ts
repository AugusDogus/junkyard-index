import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  brandywineBody,
  brandywineRedirect,
  type BrandywineReceipt,
} from "./brandywine-html";
import { parseBrandywineControl } from "./brandywine-catalog";
import { brandywineDonors } from "./brandywine-cursor";
import { extractBrandywineDetail } from "./brandywine-parser";

const schema = z.object({
  provenance: z.string(),
  pages: z.array(
    z.object({
      kind: z.enum(["opening", "closing", "detail"]),
      url: z.string(),
      html: z.string(),
      source: z.object({
        file: z.string(),
        bytes: z.number(),
        sha256: z.string(),
      }),
    }),
  ),
});
let cached: z.infer<typeof schema> | undefined;
export function brandywineNativeFixtures() {
  if (!cached) {
    const value: unknown = JSON.parse(
      gunzipSync(
        readFileSync(
          new URL(
            "./brandywine-test-fixtures/native-samples.json.gz",
            import.meta.url,
          ),
        ),
      ).toString("utf8"),
    );
    cached = schema.parse(value);
  }
  return cached;
}

/** Excerpt bodies use fixture receipts with the exact observed redirect shape. */
export function brandywineFixtureReceipt(page: {
  url: string;
  html: string;
}): BrandywineReceipt {
  const finalUrl = brandywineRedirect(page.url) ?? page.url;
  return {
    requestUrl: page.url,
    finalUrl,
    wires:
      finalUrl === page.url
        ? [{ url: page.url, status: 200, body: brandywineBody(page.html) }]
        : [
            {
              url: page.url,
              status: 301,
              body: brandywineBody(""),
            },
            { url: finalUrl, status: 200, body: brandywineBody(page.html) },
          ],
  };
}
export function brandywineSavedControls(kind: "opening" | "closing") {
  return brandywineNativeFixtures()
    .pages.filter((page) => page.kind === kind)
    .map((page) =>
      parseBrandywineControl(
        page.html,
        page.url,
        brandywineFixtureReceipt(page),
      ),
    );
}
export function brandywineSavedDetails() {
  const pages = new Map(
    brandywineNativeFixtures()
      .pages.filter((page) => page.kind === "detail")
      .map((page) => [page.url, page]),
  );
  return brandywineDonors(brandywineSavedControls("opening")).map((donor) => {
    const page = pages.get(donor.url);
    if (!page) throw new Error("Missing saved detail " + donor.url);
    return extractBrandywineDetail(
      page.html,
      page.url,
      brandywineFixtureReceipt(page),
    );
  });
}
export function brandywineReference() {
  const value: unknown = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./brandywine-test-fixtures/reference.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  );
  return z
    .object({
      canonical: z.array(
        z
          .object({
            vin: z.string(),
            source: z.literal("brandywine"),
            year: z.number(),
            make: z.string(),
            model: z.string(),
            color: z.string().nullable(),
            stockNumber: z.string(),
            imageUrl: z.null(),
            availableDate: z.string().nullable(),
            locationCode: z.string(),
            locationName: z.string(),
            locationCity: z.string(),
            state: z.string(),
            stateAbbr: z.string(),
            lat: z.number(),
            lng: z.number(),
            section: z.null(),
            row: z.string().nullable(),
            space: z.null(),
            detailsUrl: z.string(),
            partsUrl: z.null(),
            pricesUrl: z.null(),
            engine: z.null(),
            trim: z.null(),
            transmission: z.null(),
          })
          .strict(),
      ),
      presence: z.array(z.string()),
    })
    .parse(value);
}
