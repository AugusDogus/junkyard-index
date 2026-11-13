import { z } from "zod";
import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";

export const rohnerUsableText = (value: string) =>
  /[a-z0-9]/i.test(value) &&
  !/^(?:0+|other|unknown|not\s*available|n[\s/.-]*a[\s.]*|none|null|undefined|[-?]+)$/i.test(
    value.trim(),
  );

const Claim = z.object({
  boundary: z.string(),
  value: z.string(),
  rawValue: z.string().optional(),
});
const Field = Claim.extend({ label: z.string(), raw: z.string() });
const Image = z.record(z.string(), z.string());
export const RohnerArticleRawSchema = z.object({
  requestUrl: z.string().url(),
  body: z.object({
    bytes: z.number().int(),
    sha256: z.string(),
  }),
  summaries: z.array(
    z.object({
      titles: z.array(z.string()),
      fields: z.array(Field),
      unlabelledLines: z.array(z.string()),
      skuValues: z.array(z.string()),
      categories: z.array(z.object({ text: z.string(), href: z.string() })),
      fullText: z.string(),
    }),
  ),
  namedClaims: z.array(Claim),
  destinationClaims: z.array(Claim),
  galleryImages: z.array(Image),
  structuredDocuments: z.array(z.unknown()),
  structuredParseErrors: z.array(
    z.object({ error: z.string(), raw: z.string() }),
  ),
});
export const RohnerCardSchema = z
  .object({
    id: z.string(),
    classes: z.array(z.string()),
    titles: z.array(z.string()),
    destinationOccurrences: z.array(
      z.object({
        text: z.string(),
        href: z.string(),
        title: z.string().nullable().optional(),
      }),
    ),
    imageOccurrences: z.array(Image),
  })
  .passthrough();
export type RohnerArticleRaw = z.infer<typeof RohnerArticleRawSchema>;
export type RohnerCard = z.infer<typeof RohnerCardSchema>;
const NullableText = z.string().nullable();
export const RohnerCandidateSchema = z.object({
  vin: z.string(),
  year: z.number().int(),
  make: z.string(),
  model: z.string(),
  stockNumber: NullableText,
  imageUrl: NullableText,
  color: NullableText,
  trim: NullableText,
  engine: NullableText,
  transmission: NullableText,
  availableDate: z.null(),
  section: z.null(),
  row: z.null(),
  space: z.null(),
  detailsUrl: z.string(),
  partsUrl: z.null(),
  pricesUrl: z.null(),
});
export type RohnerCandidate = z.infer<typeof RohnerCandidateSchema>;
const Evidence = z.object({
  detailsUrl: z.string(),
  rawBody: RohnerArticleRawSchema.shape.body,
  validVinClaims: z.array(z.string()),
  claimedDestinations: z.array(z.string()),
  nativeRequiredFields: z.array(Field),
  cards: z.array(z.string()),
  nativeNamedClaims: z.array(Claim),
  statusClaims: z.array(Claim),
  scopeObservations: z.array(Claim),
  imageEvidenceIssues: z.array(Claim),
  reasons: z.array(z.string()),
});
export const RohnerArticleResultSchema = z
  .union([
    Evidence.extend({
      status: z.literal("required-pass"),
      candidate: RohnerCandidateSchema,
    }),
    Evidence.extend({
      status: z.enum([
        "boundary-unknown",
        "identity-conflict",
        "required-reject",
      ]),
      candidate: z.null(),
    }),
  ])
  .superRefine((result, context) => {
    const clean = (value: string) => value.trim().replace(/\s+/g, " ");
    const fields = (label: string) =>
      result.nativeRequiredFields
        .filter((field) => field.label.toLowerCase() === label.toLowerCase())
        .map((field) => clean(field.value));
    const years = fields("Year");
    const vins = [
      ...new Set(
        fields("VIN").flatMap((value) =>
          (years.length ? years : [""]).flatMap((year) => {
            const vin = inventoryVin(value, year);
            return vin === null ? [] : [vin];
          }),
        ),
      ),
    ].sort();
    if (
      JSON.stringify(vins) !== JSON.stringify([...result.validVinClaims].sort())
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Rohner observed VIN presence disagrees with retained native identity claims",
      });
    if (result.status !== "required-pass") return;
    const candidate = result.candidate;
    const year = years[0] ?? "";
    const make = fields("Make")[0] ?? "";
    const model = fields("Model")[0] ?? "";
    const prefix = clean(year + " " + make + " " + model).toLowerCase();
    if (
      candidate.detailsUrl !== result.detailsUrl ||
      !isRohnerArticleUrl(result.detailsUrl) ||
      !result.cards.length ||
      result.claimedDestinations.some((value) => value !== result.detailsUrl) ||
      !result.claimedDestinations.includes(result.detailsUrl) ||
      vins.length !== 1 ||
      candidate.vin !== vins[0] ||
      candidate.year !== Number(year) ||
      !/^\d{4}$/.test(year) ||
      candidate.year < 1886 ||
      candidate.year > 2100 ||
      !rohnerUsableText(make) ||
      !rohnerUsableText(model) ||
      candidate.make !== normalizeCanonicalMake(make) ||
      candidate.model !== model ||
      ["Year", "Make", "Model", "VIN"].some(
        (label) =>
          new Set(fields(label).map((value) => value.toLowerCase())).size !== 1,
      ) ||
      result.nativeNamedClaims.some((claim) => {
        const text = clean(claim.value).toLowerCase();
        return (
          /^\d{4}\b/.test(text) &&
          text !== prefix &&
          !text.startsWith(prefix + " ") &&
          !text.startsWith(prefix + "(")
        );
      })
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Rohner passing candidate contradicts retained native VIN/YMM/destination evidence",
      });
  });
export type RohnerArticleResult = z.infer<typeof RohnerArticleResultSchema>;

export function isRohnerArticleUrl(value: string): boolean {
  const url = URL.parse(value);
  return (
    url !== null &&
    url.href === value &&
    url.origin === "https://rohnersautoparts.com" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/shop\/[a-z0-9_-]+\/$/i.test(url.pathname)
  );
}
