import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { RohnerCandidateSchema, RohnerCardSchema } from "./rohner-record";

const source = z.object({
  file: z.string(),
  bytes: z.number(),
  sha256: z.string(),
});
const claim = z.object({
  boundary: z.string(),
  value: z.string(),
  rawValue: z.string().optional(),
});
const fixtures = z.object({
  provenance: z.string(),
  articles: z.array(
    z.object({
      stock: z.string(),
      url: z.string(),
      html: z.string(),
      source,
      cards: z.array(RohnerCardSchema),
      expected: z.object({
        status: z.enum([
          "required-pass",
          "boundary-unknown",
          "identity-conflict",
          "required-reject",
        ]),
        candidate: RohnerCandidateSchema.nullable(),
        validVinClaims: z.array(z.string()),
        claimedDestinations: z.array(z.string()),
        scopeObservations: z.array(claim),
        imageEvidenceIssues: z.array(claim),
      }),
    }),
  ),
  catalogs: z.array(
    z.object({
      url: z.string(),
      html: z.string(),
      source,
      expected: z.object({
        page: z.number(),
        range: z.object({
          first: z.number(),
          last: z.number(),
          total: z.number(),
        }),
        cards: z.number(),
        pagination: z.array(z.object({ text: z.string(), href: z.string() })),
      }),
    }),
  ),
});

let cached: z.infer<typeof fixtures> | undefined;
export function rohnerNativeFixtures() {
  if (cached) return cached;
  const value: unknown = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./rohner-test-fixtures/native-samples.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  );
  cached = fixtures.parse(value);
  return cached;
}

export function rohnerFixture(stock: string) {
  const value = rohnerNativeFixtures().articles.find(
    (article) => article.stock === stock,
  );
  if (!value) throw new Error("Missing Rohner native fixture " + stock);
  return value;
}
