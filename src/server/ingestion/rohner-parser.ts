import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import {
  isRohnerArticleUrl,
  rohnerUsableText as usable,
  type RohnerArticleRaw,
  type RohnerArticleResult,
  type RohnerCard,
} from "./rohner-record";
import { extractRohnerArticle } from "./rohner-html";
import type { RohnerPost } from "./rohner-catalog";
export * from "./rohner-catalog";
export { isRohnerArticleUrl, RohnerArticleResultSchema } from "./rohner-record";

const clean = (value: string) => value.trim().replace(/\s+/g, " ");
const comparable = (value: string) => clean(value).toLowerCase();
const distinct = (values: string[]) => [...new Set(values.map(clean))];
const optional = (values: string[]) => {
  const usableValues = distinct(values.filter((value) => usable(clean(value))));
  return usableValues.length === 1 ? (usableValues[0] ?? null) : null;
};
const destinationBase = (value: string) => {
  const url = URL.parse(value);
  if (!url) return value;
  url.hash = "";
  return url.href;
};
const componentImage = (value: string) =>
  /\b(?:fits|fitment|headlight|taillight)\b/i.test(value);
const imageUrl = (value: string | undefined) => {
  const url = value === undefined ? null : URL.parse(value);
  return url &&
    url.origin === "https://rohnersautoparts.com" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname.startsWith("/wp-content/uploads/") &&
    /\.(?:jpe?g|png|webp)$/i.test(url.pathname) &&
    !/placeholder/i.test(url.href)
    ? url.href
    : null;
};

export function acceptRohnerArticle(
  raw: RohnerArticleRaw,
  cards: RohnerCard[],
): RohnerArticleResult {
  const fields = raw.summaries.flatMap((summary) => summary.fields);
  const values = (label: string) =>
    fields
      .filter((field) => field.label.toLowerCase() === label.toLowerCase())
      .map((field) => field.value);
  const yearValues = distinct(values("Year"));
  const vinValues = distinct(values("VIN"));
  const validVinClaims = [
    ...new Set(
      vinValues.flatMap((vin) =>
        (yearValues.length ? yearValues : [""]).flatMap((year) => {
          const validated = inventoryVin(vin, year);
          return validated === null ? [] : [validated];
        }),
      ),
    ),
  ];
  const claimedDestinations = distinct([
    raw.requestUrl,
    ...raw.destinationClaims.map((claim) => destinationBase(claim.value)),
    ...cards.flatMap((card) =>
      card.destinationOccurrences.map((link) => destinationBase(link.href)),
    ),
  ]);
  const nativeNamedClaims = [
    ...raw.namedClaims,
    ...cards.flatMap((card) => [
      ...card.titles.map((value) => ({ boundary: card.id + ":title", value })),
      ...card.imageOccurrences.flatMap((image) =>
        ["alt", "title"].flatMap((key) =>
          image[key]
            ? [{ boundary: card.id + ":image-" + key, value: image[key] ?? "" }]
            : [],
        ),
      ),
    ]),
  ];
  const statusClaims = nativeNamedClaims.filter((claim) =>
    /\b(?:scrap|sold[- ]rebuilder|part out)\b/i.test(claim.value),
  );
  const scopeObservations = statusClaims.filter((claim) =>
    /\b(?:scrap|sold[- ]rebuilder)\b/i.test(claim.value),
  );
  const imageEvidenceIssues = nativeNamedClaims.filter(
    (claim) => /image/i.test(claim.boundary) && componentImage(claim.value),
  );
  const base = {
    detailsUrl: raw.requestUrl,
    rawBody: raw.body,
    validVinClaims,
    claimedDestinations,
    nativeRequiredFields: fields.filter((field) =>
      /^(?:year|make|model|vin)$/i.test(field.label),
    ),
    cards: cards.map((card) => card.id),
    nativeNamedClaims,
    statusClaims,
    scopeObservations,
    imageEvidenceIssues,
  };
  if (raw.summaries.length !== 1 || raw.structuredParseErrors.length)
    return {
      ...base,
      status: "boundary-unknown",
      reasons: [
        "Native product/required-label boundary or structured document changed",
      ],
      candidate: null,
    };
  if (
    !isRohnerArticleUrl(raw.requestUrl) ||
    !cards.length ||
    cards.some((card) =>
      card.destinationOccurrences.some((link) => link.href !== raw.requestUrl),
    )
  )
    return {
      ...base,
      status: "identity-conflict",
      reasons: ["Native source-bound donor destination disagrees"],
      candidate: null,
    };
  const conflicts: string[] = [];
  const required: Record<string, string> = {};
  for (const label of ["Year", "Make", "Model", "VIN"]) {
    const claims = distinct(values(label));
    const normalized = [
      ...new Set(
        claims.map((value) =>
          label === "VIN" ? value.toUpperCase() : comparable(value),
        ),
      ),
    ];
    if (normalized.length > 1)
      conflicts.push("Conflicting native " + label + " claims");
    required[label] = claims[0] ?? "";
  }
  const year = required.Year ?? "";
  const make = required.Make ?? "";
  const model = required.Model ?? "";
  const vin = inventoryVin(required.VIN ?? "", year);
  const requiredMissing =
    !/^\d{4}$/.test(year) ||
    Number(year) < 1886 ||
    Number(year) > 2100 ||
    !usable(make) ||
    !usable(model) ||
    vin === null;
  for (const claim of raw.destinationClaims) {
    const value = claim.boundary.endsWith(".@id")
      ? destinationBase(claim.value)
      : claim.value;
    if (value !== raw.requestUrl)
      conflicts.push("Conflicting native destination at " + claim.boundary);
  }
  if (!requiredMissing) {
    const prefix = comparable(year + " " + make + " " + model);
    for (const claim of nativeNamedClaims) {
      const text = comparable(claim.value);
      if (
        /^\d{4}\b/.test(text) &&
        text !== prefix &&
        !text.startsWith(prefix + " ") &&
        !text.startsWith(prefix + "(")
      )
        conflicts.push("Unreconciled explicit YMM claim at " + claim.boundary);
    }
  }
  if (conflicts.length)
    return {
      ...base,
      status: "identity-conflict",
      reasons: distinct(conflicts),
      candidate: null,
      nativeNamedClaims,
      statusClaims,
      scopeObservations,
      imageEvidenceIssues,
    };
  if (requiredMissing || vin === null)
    return {
      ...base,
      status: "required-reject",
      reasons: [
        "Native VIN or supported older serial / year / make / model is missing or invalid",
      ],
      candidate: null,
      nativeNamedClaims,
      statusClaims,
      scopeObservations,
      imageEvidenceIssues,
    };
  if (
    !raw.summaries.every((summary) =>
      summary.categories.some(
        (category) =>
          category.text === "Vehicles" &&
          category.href ===
            "https://rohnersautoparts.com/product-category/vehicles/",
      ),
    )
  )
    return {
      ...base,
      status: "boundary-unknown",
      reasons: ["Native Vehicles category membership is missing or changed"],
      candidate: null,
      nativeNamedClaims,
      statusClaims,
      scopeObservations,
    };
  const titleStocks = nativeNamedClaims.flatMap((claim) =>
    [...claim.value.matchAll(/\(([a-z0-9-]+)\)/gi)].map(
      (match) => match[1] ?? "",
    ),
  );
  const stock = optional([
    ...raw.summaries.flatMap((summary) => summary.skuValues),
    ...titleStocks,
  ]);
  const stockNumber =
    stock !== null &&
    stock.length <= 100 &&
    !/[/?#]/.test(stock) &&
    ![...stock].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
      ? stock
      : null;
  const photo =
    raw.galleryImages
      .filter(
        (image) =>
          !componentImage((image.alt ?? "") + " " + (image.title ?? "")),
      )
      .flatMap((image) => [imageUrl(image["data-src"]), imageUrl(image.src)])
      .find((value) => value !== null) ?? null;
  const candidate = {
    vin,
    year: Number(year),
    make: normalizeCanonicalMake(make),
    model,
    stockNumber,
    imageUrl: photo,
    color: normalizeCanonicalColor(optional(values("Color"))),
    trim: optional(values("Submodel")),
    engine: optional(values("Engine")),
    transmission: optional(values("Transmission")),
    availableDate: null,
    section: null,
    row: null,
    space: null,
    detailsUrl: raw.requestUrl,
    partsUrl: null,
    pricesUrl: null,
  };
  return {
    ...base,
    status: "required-pass",
    reasons: [],
    candidate,
    nativeNamedClaims,
    statusClaims,
    scopeObservations,
    imageEvidenceIssues,
  };
}

export function parseRohnerArticle(
  html: string,
  requestUrl: string,
  cards: RohnerCard[],
): RohnerArticleResult {
  return acceptRohnerArticle(extractRohnerArticle(html, requestUrl), cards);
}
export function parseRohnerDetail(
  html: string,
  post: RohnerPost,
): RohnerArticleResult {
  return parseRohnerArticle(html, post.url, [post.card]);
}
