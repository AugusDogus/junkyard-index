import { createHash } from "node:crypto";
import { z } from "zod";
import { inventoryHtmlAttribute } from "./inventory-html";
import { mccauleyDivs, mccauleyDocument, mccauleyText } from "./mccauley-html";
import {
  MCCAULEY_DETAIL_ORIGIN,
  verifyMccauleyYard,
} from "./mccauley-yard-metadata";

export function isMccauleyDetailUrl(raw: string): boolean {
  const url = URL.parse(raw);
  return (
    url !== null &&
    url.origin === MCCAULEY_DETAIL_ORIGIN &&
    url.href === raw &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/mccauleysauto\/parts-[a-z0-9]+(?:-[a-z0-9]+)*\.html$/.test(url.pathname)
  );
}

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const fingerprint = (value: string) =>
  createHash("sha256").update(value).digest("hex");
// The raw response hash pins the source artifact. A separate stable projection
// hash detects corruption of retained native fields across durable checkpoints.
const catalogProjection = (value: { hash: string; posts: MccauleyPost[] }) =>
  fingerprint(
    JSON.stringify([
      value.hash,
      value.posts.map((post) => [post.url, post.label]),
    ]),
  );
const currentProjection = (value: { hash: string; headings: string[] }) =>
  fingerprint(JSON.stringify([value.hash, value.headings]));
const detailProjection = (value: {
  hash: string;
  post: MccauleyPost;
  heading: string;
  paragraphs: string[];
}) =>
  fingerprint(
    JSON.stringify([
      value.hash,
      value.post.url,
      value.post.label,
      value.heading,
      value.paragraphs,
    ]),
  );
export const MccauleyPostSchema = z
  .object({
    url: z.string().max(1000).refine(isMccauleyDetailUrl),
    label: z.string().trim().min(1).max(300),
  })
  .strict();
export type MccauleyPost = z.infer<typeof MccauleyPostSchema>;
export const MccauleyCatalogSchema = z
  .object({
    hash,
    projectionHash: hash,
    posts: z.array(MccauleyPostSchema).min(1).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.projectionHash !== catalogProjection(value))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "McCauley catalog projection fingerprint changed",
      });
    if (new Set(value.posts.map((p) => p.url)).size !== value.posts.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Repeated McCauley catalog destination",
      });
  });
export type MccauleyCatalog = z.infer<typeof MccauleyCatalogSchema>;
export const MccauleyCurrentSchema = z
  .object({
    hash,
    projectionHash: hash,
    headings: z.array(z.string().min(1).max(1000)).min(1).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.projectionHash !== currentProjection(value))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "McCauley current projection fingerprint changed",
      });
  });
export type MccauleyCurrent = z.infer<typeof MccauleyCurrentSchema>;
export const MccauleyDetailSchema = z
  .object({
    hash,
    projectionHash: hash,
    post: MccauleyPostSchema,
    heading: z.string().max(1000),
    paragraphs: z.array(z.string().max(10_000)).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.projectionHash !== detailProjection(value))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "McCauley detail projection fingerprint changed",
      });
  });
export type MccauleyDetail = z.infer<typeof MccauleyDetailSchema>;

function nativeList(raw: string): string {
  const html = mccauleyDocument(raw);
  verifyMccauleyYard(mccauleyText(html));
  return html;
}

export function parseMccauleyCatalog(raw: string): MccauleyCatalog {
  const html = nativeList(raw);
  if (!/<title>\s*Parts Vehicles - Mccauleys Auto Llc\s*<\/title>/i.test(html))
    throw new Error("McCauley Parts Vehicles catalog title changed");
  const posts = new Map<string, MccauleyPost>();
  const emptyAliases: string[] = [];
  for (const match of html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a\s*>/gi)) {
    const href = inventoryHtmlAttribute(match[1] ?? "", "href");
    if (!href) continue;
    const url = mccauleyText(href);
    if (!url.includes("/mccauleysauto/parts-")) continue;
    const label = mccauleyText(match[2] ?? "");
    // Two native formatting anchors repeat already labelled donor URLs with
    // no visible text. They may alias a labelled entry, never erase a donor.
    if (!label && isMccauleyDetailUrl(url)) {
      emptyAliases.push(url);
      continue;
    }
    const post = MccauleyPostSchema.parse({ url, label });
    if (!/^\d{4}\s+\S/.test(post.label))
      throw new Error(
        "McCauley native catalog donor label is missing its year/model",
      );
    const previous = posts.get(url);
    if (previous && previous.label !== post.label)
      throw new Error(
        "McCauley catalog destination has conflicting native labels",
      );
    posts.set(url, post);
  }
  if (emptyAliases.some((url) => !posts.has(url)))
    throw new Error("McCauley catalog has an unlabelled donor destination");
  // This inspected source is a finite linked index, not a pagination API.
  if (
    /<(?:a|button)\b[^>]*(?:rel=["']next["']|class=["'][^"']*pagination)/i.test(
      html,
    )
  )
    throw new Error(
      "McCauley catalog gained pagination; inspect complete traversal before proceeding",
    );
  const value = { hash: fingerprint(raw), posts: [...posts.values()] };
  return MccauleyCatalogSchema.parse({
    ...value,
    projectionHash: catalogProjection(value),
  });
}

export function parseMccauleyCurrent(raw: string): MccauleyCurrent {
  const html = nativeList(raw);
  const plain = mccauleyText(html);
  if (
    !plain.includes("Salvage Vehicles") ||
    !plain.includes("Here are current vehicles we are parting out.")
  )
    throw new Error("McCauley native current donor scope changed");
  const headings = mccauleyDivs(html, "kv-ee-content-card").map((card) => {
    const matches = [...card.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3\s*>/gi)];
    const heading = mccauleyText(matches[0]?.[1] ?? "");
    if (matches.length !== 1 || !/^Vehicle\s+\d+\b/i.test(heading))
      throw new Error(
        "McCauley current donor card is incomplete or has an unrecognized identity header",
      );
    if ([...heading.matchAll(/\bVIN\s*:/gi)].length > 1)
      throw new Error(
        "McCauley current donor card contains multiple VIN identities",
      );
    return heading;
  });
  if (
    [...html.matchAll(/<h3\b[^>]*>\s*Vehicle\b/gi)].length !== headings.length
  )
    throw new Error(
      "McCauley current donor identity appears outside a complete native card",
    );
  const value = { hash: fingerprint(raw), headings };
  return MccauleyCurrentSchema.parse({
    ...value,
    projectionHash: currentProjection(value),
  });
}

export function parseMccauleyDetail(
  raw: string,
  post: MccauleyPost,
): MccauleyDetail {
  MccauleyPostSchema.parse(post);
  const html = mccauleyDocument(raw);
  const plain = mccauleyText(html);
  if (!plain.includes("MCCAULEY'S AUTO") || !/\bparts\b/i.test(plain))
    throw new Error(
      "McCauley source-linked parts vehicle detail changed ownership or scope",
    );
  // Native component offers also use h2 (for example ENGINE - SOLD). Only
  // year-led native vehicle headings define the donor identity boundary.
  const headings = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/gi)]
    .map((match) => mccauleyText(match[1] ?? ""))
    .filter((text) => /^\d{4}\s+\S/.test(text));
  if (headings.length !== 1)
    throw new Error(
      "McCauley donor detail must have one native vehicle heading",
    );
  const paragraphs = mccauleyDivs(html, "paragraph").map((block) =>
    block
      .split(/<br\s*\/?>/gi)
      .map(mccauleyText)
      .filter(Boolean)
      .join("\n"),
  );
  if (
    [...plain.matchAll(/\bVIN\s*:/gi)].length !==
    [...paragraphs.join("\n").matchAll(/^VIN\s*:/gim)].length
  )
    throw new Error(
      "McCauley donor VIN appears outside the inspected native paragraph grammar",
    );
  if (
    /\b(?:vehicle|donor)\s+(?:is\s+|has been\s+)?(?:sold|removed|unavailable)\b|\bno longer parting\b/i.test(
      paragraphs.join(" "),
    )
  )
    throw new Error(
      "McCauley whole-donor availability language changed; inspect native scope before continuing",
    );
  const value = {
    hash: fingerprint(raw),
    post,
    heading: headings[0] ?? "",
    paragraphs,
  };
  return MccauleyDetailSchema.parse({
    ...value,
    projectionHash: detailProjection(value),
  });
}
