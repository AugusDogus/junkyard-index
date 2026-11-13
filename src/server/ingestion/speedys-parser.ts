import { createHash } from "node:crypto";
import { z } from "zod";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import {
  SPEEDYS_MAX_CATEGORIES,
  SPEEDYS_MAX_DONORS,
  SPEEDYS_MAX_RESPONSE_BYTES,
  speedysCatalogCategory,
  speedysDonorId,
} from "./speedys-yard-metadata";

export const speedysHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const text = z.string().max(1000);
const receipt = {
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
  bodyBytes: z.number().int().positive().max(SPEEDYS_MAX_RESPONSE_BYTES),
};
export const SpeedysPostSchema = z
  .object({
    id: z.string().regex(/^[1-9]\d{0,8}$/),
    url: z.string().refine((v) => speedysDonorId(v) !== null),
    year: text,
    make: text,
    model: text,
  })
  .strict()
  .refine((v) => speedysDonorId(v.url) === v.id);
export type SpeedysPost = z.infer<typeof SpeedysPostSchema>;
export const SpeedysCategorySchema = z
  .object({
    id: z.string().regex(/^[1-9]\d{0,8}$/),
    make: text.min(1),
    count: z.number().int().positive().max(SPEEDYS_MAX_DONORS),
  })
  .strict();
export const SpeedysCatalogSchema = z
  .object({
    url: z.string().refine((v) => speedysCatalogCategory(v) !== null),
    categories: z
      .array(SpeedysCategorySchema)
      .min(1)
      .max(SPEEDYS_MAX_CATEGORIES),
    posts: z.array(SpeedysPostSchema).min(1).max(SPEEDYS_MAX_DONORS),
    ...receipt,
  })
  .strict();
export type SpeedysCatalog = z.infer<typeof SpeedysCatalogSchema>;
const claims = z.array(text).max(16);
export const SpeedysRecordSchema = z
  .object({
    post: SpeedysPostSchema,
    claims: z
      .object({
        year: claims,
        make: claims,
        model: claims,
        vin: claims,
        stock: claims,
      })
      .strict(),
    ...receipt,
  })
  .strict();
export type SpeedysRecord = z.infer<typeof SpeedysRecordSchema>;

function plain(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|nbsp|quot|apos|lt|gt|#39);/gi, (entity) => {
      switch (entity.toLowerCase()) {
        case "&amp;":
          return "&";
        case "&nbsp;":
          return " ";
        case "&quot;":
          return '"';
        case "&apos;":
        case "&#39;":
          return "'";
        case "&lt;":
          return "<";
        default:
          return ">";
      }
    })
    .replace(/\s+/g, " ")
    .trim();
}
function main(raw: string): string {
  const clean = stripInventoryRawText(raw);
  const content = [...clean.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/gi)];
  if (
    Buffer.byteLength(raw) > SPEEDYS_MAX_RESPONSE_BYTES ||
    !/<\/html\s*>\s*$/i.test(clean) ||
    content.length !== 1 ||
    !content[0]?.[1] ||
    [...clean.matchAll(/<\/?main\b/gi)].length !== 2 ||
    !/Speedy's Transmission/i.test(plain(clean))
  )
    throw new Error(
      "Speedys native HTML is incomplete, oversized or has an unrecognized owner",
    );
  return content[0][1];
}
const bodyReceipt = (raw: string) => ({
  bodyHash: createHash("sha256").update(raw).digest("hex"),
  bodyBytes: Buffer.byteLength(raw),
});
export function speedysCatalogMembership(page: SpeedysCatalog) {
  return { url: page.url, categories: page.categories, posts: page.posts };
}
export function parseSpeedysCatalog(raw: string, url: string): SpeedysCatalog {
  const category = speedysCatalogCategory(url);
  const content = main(raw);
  const pagers = [
    ...content.matchAll(/<ul\b([^>]*)>([\s\S]*?)<\/ul\s*>/gi),
  ].filter((m) =>
    (inventoryHtmlAttribute(m[1] ?? "", "class") ?? "")
      .split(/\s+/)
      .includes("pagination"),
  );
  if (
    category === null ||
    pagers.length !== 1 ||
    plain(pagers[0]?.[2] ?? "") ||
    /<a\b|<li\b/i.test(pagers[0]?.[2] ?? "") ||
    /<(?:form|select|input|button)\b/i.test(content) ||
    [...content.matchAll(/<h6\b[^>]*>\s*MAKES\s*<\/h6>/gi)].length !== 1
  )
    throw new Error(
      "Speedys catalog has unsupported pagination, filters or make-directory structure; complete inventory is not established",
    );
  const categories: z.infer<typeof SpeedysCategorySchema>[] = [];
  const posts: SpeedysPost[] = [];
  let all = 0;
  for (const match of content.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = inventoryHtmlAttribute(match[1] ?? "", "href");
    if (!href)
      throw new Error("Speedys catalog link lacks its native destination");
    const destination = new URL(href.replaceAll("&amp;", "&"), url).href;
    const cat = speedysCatalogCategory(destination);
    const id = speedysDonorId(destination);
    const body = match[2] ?? "";
    if (cat !== null && cat !== "default") {
      const label = plain(body);
      if (cat === "0") {
        if (label !== "ALL")
          throw new Error("Speedys ALL control label changed");
        all++;
      } else {
        const named = /^(.+?)\s*\(([1-9]\d*)\)$/.exec(label);
        if (!named?.[1] || !named[2])
          throw new Error("Speedys category label/count is missing");
        categories.push(
          SpeedysCategorySchema.parse({
            id: cat,
            make: named[1],
            count: Number(named[2]),
          }),
        );
      }
    } else if (id) {
      const makes = [
        ...body.matchAll(
          /<h5\b[^>]*class=["'][^"']*\bcard-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h5>/gi,
        ),
      ];
      const labels = [
        ...body.matchAll(
          /<p\b[^>]*class=["'][^"']*\bcard-text\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi,
        ),
      ];
      const named = /^(.*?)\s*-\s*(\d{4})$/.exec(plain(labels[0]?.[1] ?? ""));
      if (makes.length !== 1 || labels.length !== 1 || !named?.[1] || !named[2])
        throw new Error(
          "Speedys donor card has ambiguous native year/make/model",
        );
      posts.push(
        SpeedysPostSchema.parse({
          id,
          url: destination,
          make: plain(makes[0]?.[1] ?? ""),
          model: named[1],
          year: named[2],
        }),
      );
    } else
      throw new Error(
        "Speedys catalog contains an unsupported native scope or donor control",
      );
  }
  if (
    all !== 1 ||
    new Set(categories.map((v) => v.id)).size !== categories.length ||
    new Set(posts.map((v) => v.id)).size !== posts.length ||
    (category !== "default" &&
      category !== "0" &&
      !categories.some((v) => v.id === category))
  )
    throw new Error(
      "Speedys category controls or donor identities repeat or disagree",
    );
  return SpeedysCatalogSchema.parse({
    url,
    categories,
    posts,
    ...bodyReceipt(raw),
  });
}
export function parseSpeedysDetail(
  raw: string,
  post: SpeedysPost,
): SpeedysRecord {
  const content = main(raw);
  const headings = [
    ...content.matchAll(
      /<div\b[^>]*class=["'][^"']*\bflex-center\b[^"']*\bborde2\b[^"']*["'][^>]*>([\s\S]*?)<div\b[^>]*class=["']p-2["']/gi,
    ),
  ];
  const header = headings[0]?.[1] ?? "";
  const makes = [...header.matchAll(/<h5\b[^>]*>([\s\S]*?)<\/h5>/gi)];
  const ymm = [...header.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)].filter(
    (m) =>
      (inventoryHtmlAttribute(m[1] ?? "", "class") ?? "")
        .split(/\s+/)
        .includes("text-seconday"),
  );
  if (
    headings.length !== 1 ||
    makes.length !== 1 ||
    ymm.length !== 2 ||
    !/5300 Midlothian Turnpike\s+Richmond, VA 23225/.test(plain(header))
  )
    throw new Error(
      "Speedys primary donor heading or native yard address is missing or changed",
    );
  const fields: SpeedysRecord["claims"] = {
    year: [post.year, plain(ymm[1]?.[2] ?? "")],
    make: [post.make, plain(makes[0]?.[1] ?? "")],
    model: [post.model, plain(ymm[0]?.[2] ?? "")],
    vin: [],
    stock: [],
  };
  for (const paragraph of content.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const value = plain(paragraph[1] ?? "");
    const stock = /^Inventory\s*#\s*(\S+)/i.exec(value);
    if (stock?.[1]) fields.stock.push(stock[1]);
    const vin = /^VIN\s*:\s*(.*)$/i.exec(value);
    if (vin) fields.vin.push(vin[1] ?? "");
    // Blank auxiliary labels are not assertions and cannot erase the header.
    for (const claim of value.matchAll(
      /(?:^|,\s*)(Manufacturer|Make|Model|Year)\s*:\s*([^,]*)/gi,
    )) {
      const candidate = claim[2]?.trim();
      if (!candidate) continue;
      const key = claim[1]?.toLowerCase();
      if (key === "manufacturer" || key === "make") fields.make.push(candidate);
      else if (key === "model") fields.model.push(candidate);
      else fields.year.push(candidate);
    }
  }
  if (fields.stock.length !== 1 || fields.stock[0] !== post.id)
    throw new Error(
      "Speedys detail inventory ID does not join its enumerated donor destination",
    );
  return SpeedysRecordSchema.parse({
    post,
    claims: fields,
    ...bodyReceipt(raw),
  });
}
