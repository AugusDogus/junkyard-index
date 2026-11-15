import { createHash } from "node:crypto";
import { z } from "zod";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

export const HAGERMAN_ORIGIN = "https://hagermanparts.com";
export const HAGERMAN_CATALOG_URL = HAGERMAN_ORIGIN + "/shop/?part_type=99000";
export const HAGERMAN_PROFILE_URL = HAGERMAN_ORIGIN + "/contact-hagerman/";

function text(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(#x[\da-f]+|#\d+|amp|quot|apos|nbsp|lt|gt);/gi,
      (_entity: string, key: string) => {
        const named: Record<string, string> = {
          amp: "&",
          quot: '"',
          apos: "'",
          nbsp: " ",
          lt: "<",
          gt: ">",
        };
        const value = named[key.toLowerCase()];
        if (value !== undefined) return value;
        const hex = /^#x/i.test(key);
        const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (
          !Number.isSafeInteger(point) ||
          point < 1 ||
          point > 0x10ffff ||
          (point >= 0xd800 && point <= 0xdfff)
        )
          throw new Error("Invalid Hagerman character reference");
        return String.fromCodePoint(point);
      },
    )
    .replace(/\s+/g, " ")
    .trim();
}
const classes = (tag: string) =>
  (inventoryHtmlAttribute(tag, "class") ?? "").split(/\s+/);

/** Only the source's balanced div sections are traversed, without HTML repair. */
function divs(raw: string, matches: (tag: string) => boolean): string[] {
  return [...raw.matchAll(/<div\b[^>]*>/gi)]
    .filter(([tag]) => matches(tag))
    .map((opening) => {
      const remaining = raw.slice(opening.index);
      let depth = 0;
      for (const match of remaining.matchAll(/<\/?div\b[^>]*>/gi)) {
        depth += /^<\//.test(match[0]) ? -1 : 1;
        if (depth === 0)
          return remaining.slice(0, match.index + match[0].length);
      }
      throw new Error("Incomplete Hagerman div section");
    });
}
function one(values: string[], label: string): string {
  const value = values[0];
  if (values.length !== 1 || value === undefined)
    throw new Error("Expected one Hagerman " + label);
  return value;
}
function article(raw: string, id: string): string {
  const clean = stripInventoryRawText(raw);
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024 || !/<\/html>\s*$/i.test(clean))
    throw new Error("Oversized or truncated Hagerman document");
  const matches = [
    ...clean.matchAll(/(<article\b[^>]*>)([\s\S]*?)<\/article>/gi),
  ];
  const match = matches[0];
  if (
    matches.length !== 1 ||
    !match ||
    inventoryHtmlAttribute(match[1] ?? "", "id") !== id ||
    /<article\b/i.test(match[2] ?? "")
  )
    throw new Error("Hagerman source article scope changed");
  return match[2] ?? "";
}
function scalarBlocks(raw: string, className: string): string[] {
  return divs(raw, (tag) => classes(tag).includes(className)).map(text);
}
function fields(
  raw: string,
  labelClass: string,
  valueClass: string,
): Map<string, string> {
  const labels = scalarBlocks(raw, labelClass),
    values = scalarBlocks(raw, valueClass);
  if (labels.length !== values.length || new Set(labels).size !== labels.length)
    throw new Error(
      "Hagerman native field labels are duplicated or incomplete",
    );
  return new Map(labels.map((label, index) => [label, values[index] ?? ""]));
}
function donorId(raw: string): string | null {
  const url = URL.parse(raw);
  if (
    !url ||
    url.origin !== HAGERMAN_ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.href !== raw
  )
    return null;
  return (
    /^\/item\/[a-z0-9-]+\/[a-z0-9-]+\/dismantled-vehicles\/1125862\/1\/([1-9]\d{0,9})\/$/.exec(
      url.pathname,
    )?.[1] ?? null
  );
}
function destination(tag: string): string {
  const raw = text(inventoryHtmlAttribute(tag, "href") ?? "");
  const absolute =
    raw.startsWith("/") && !raw.startsWith("//") ? HAGERMAN_ORIGIN + raw : raw;
  // Both native image/title links omit the slash; native View Details includes it.
  const canonical = absolute.endsWith("/") ? absolute : absolute + "/";
  if (donorId(canonical) === null)
    throw new Error("Foreign or malformed Hagerman donor destination");
  return canonical;
}
const scalar = z.string().max(500);
function stock(value: string): string | null {
  const clean = value.trim();
  return clean.length <= 128 &&
    /[a-z0-9]/i.test(clean) &&
    !/^(?:unknown|other|n\/?a|none|null|0|-)$/i.test(clean)
    ? clean
    : null;
}
const nativeId = z.string().regex(/^[1-9]\d{0,9}$/);
const donorUrl = z
  .string()
  .max(1000)
  .refine((value) => donorId(value) !== null);
export const HagermanMemberSchema = z
  .object({
    id: nativeId,
    url: donorUrl,
    stock: scalar.nullable(),
    title: scalar,
    year: scalar,
    make: scalar,
    model: scalar,
  })
  .strict()
  .refine((member) => donorId(member.url) === member.id);
export type HagermanMember = z.infer<typeof HagermanMemberSchema>;
export const HagermanPageSchema = z
  .object({
    total: z.number().int().min(1).max(25),
    members: z.array(HagermanMemberSchema).min(1).max(25),
  })
  .strict()
  .refine(
    (page) =>
      page.members.length === page.total &&
      new Set(page.members.map((row) => row.id)).size === page.total,
  );
export type HagermanPage = z.infer<typeof HagermanPageSchema>;

function parseCatalog(raw: string): HagermanPage {
  const body = article(raw, "post-64");
  const forms = [...body.matchAll(/(<form\b[^>]*>)([\s\S]*?)<\/form>/gi)];
  const form = forms[0];
  if (
    forms.length !== 1 ||
    !form ||
    inventoryHtmlAttribute(form[1] ?? "", "method") !== "get" ||
    inventoryHtmlAttribute(form[1] ?? "", "action")
  )
    throw new Error("Hagerman public donor search form changed");
  const selected = [
    ...(form[2] ?? "").matchAll(/(<option\b[^>]*>)([\s\S]*?)<\/option>/gi),
  ].filter(([tag]) => inventoryHtmlAttribute(tag, "selected") !== null);
  if (
    selected.length !== 1 ||
    inventoryHtmlAttribute(selected[0]?.[1] ?? "", "value") !== "99000" ||
    text(selected[0]?.[2] ?? "") !== "Dismantled Vehicles"
  )
    throw new Error(
      "Hagerman catalog is not the complete Dismantled Vehicles category",
    );
  const selects = [
    ...(form[2] ?? "").matchAll(/(<select\b[^>]*>)([\s\S]*?)<\/select>/gi),
  ];
  const defaults = new Map([
    ["part_type", "99000"],
    ["make_manufacturer", ""],
    ["model", ""],
    ["year_start", "0"],
    ["year_end", "0"],
    ["orderby", ""],
  ]);
  if (
    selects.length !== defaults.size ||
    ![...defaults].every(([name, value]) => {
      const matching = selects.filter(
        (match) => inventoryHtmlAttribute(match[1] ?? "", "name") === name,
      );
      const options = [
        ...(matching[0]?.[2] ?? "").matchAll(
          /(<option\b[^>]*>)([\s\S]*?)<\/option>/gi,
        ),
      ];
      const chosen =
        options.find(
          ([tag]) => inventoryHtmlAttribute(tag, "selected") !== null,
        ) ?? options[0];
      return (
        matching.length === 1 &&
        inventoryHtmlAttribute(chosen?.[1] ?? "", "value") === value
      );
    })
  )
    throw new Error(
      "Hagerman donor category has active or ambiguous search filters",
    );
  const inputs = [...(form[2] ?? "").matchAll(/<input\b[^>]*>/gi)];
  if (
    inputs.length !== 3 ||
    !["keywords", "vendor", "store"].every((name) => {
      const matching = inputs.filter(
        ([tag]) => inventoryHtmlAttribute(tag, "name") === name,
      );
      return (
        matching.length === 1 &&
        inventoryHtmlAttribute(matching[0]?.[0] ?? "", "value") === ""
      );
    })
  )
    throw new Error(
      "Hagerman catalog has active or unverified inventory filters",
    );
  const totals = [...text(body).matchAll(/Showing all (\d+) results/g)];
  const total = Number(totals[0]?.[1]);
  // Current native donor graph is one terminal page, at most the published 25-row page size.
  // Growth into pagination must be qualified before this collector can publish it.
  if (
    totals.length !== 1 ||
    total < 1 ||
    total > 25 ||
    /<a\b[^>]*class="[^"]*page-numbers/i.test(body) ||
    !/<span\b[^>]*aria-current="page"[^>]*>1<\/span>/.test(body)
  )
    throw new Error(
      "Hagerman terminal single-page membership is unproven; inspect native pagination before restarting",
    );
  const cards = divs(
    body,
    (tag) => inventoryHtmlAttribute(tag, "id") === "column-item",
  );
  const members = cards.map((card) => {
    const links = [...card.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)].filter(
      ([tag]) => (inventoryHtmlAttribute(tag, "href") ?? "").includes("/item/"),
    );
    const destinations = links.map((link) => destination(link[1] ?? ""));
    const url = destinations[0] ?? "";
    if (
      links.length !== 3 ||
      destinations.some((value) => value !== url) ||
      links.filter((link) => text(link[2] ?? "") === "View Details").length !==
        1
    )
      throw new Error("Hagerman card destinations disagree or omit a donor");
    const values = fields(card, "e64-e71", "e64-e73");
    if (
      [...values.keys()].some(
        (key) => !["Type", "Make", "Model", "Year"].includes(key),
      )
    )
      throw new Error("Unassessed Hagerman catalog field");
    const headings = [...card.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
    const title = one(
      headings.map((heading) => text(heading[1] ?? "")),
      "card heading",
    );
    if (!title.endsWith(" Dismantled Vehicles"))
      throw new Error("Hagerman card left donor scope");
    const stocks = scalarBlocks(card, "e64-e62");
    if (stocks.length > 1) throw new Error("Ambiguous Hagerman card stock");
    return HagermanMemberSchema.parse({
      id: donorId(url),
      url,
      title,
      stock: stock((stocks[0] ?? "").replace(/^#/, "")),
      year: values.get("Year") ?? "",
      make: values.get("Make") ?? "",
      model: values.get("Model") ?? "",
    });
  });
  const itemLinks = [...body.matchAll(/<a\b[^>]*>/gi)].filter(([tag]) =>
    (inventoryHtmlAttribute(tag, "href") ?? "").includes("/item/"),
  );
  if (
    itemLinks.length !== cards.length * 3 ||
    [...body.matchAll(/<h3\b/gi)].length !== cards.length
  )
    throw new Error("Hagerman catalog has unaccounted donor rows or links");
  return HagermanPageSchema.parse({ total, members });
}

function imageMatches(value: string, id: string): boolean {
  const url = URL.parse(value);
  return (
    url !== null &&
    url.origin === "https://imagehost.heavytruckparts.net" &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password &&
    url.href === value &&
    new RegExp(
      `^/full_image/[A-Za-z0-9_+%-]+_1125862_1_${id}_[1-9]\\d*\\.jpg$`,
    ).test(url.pathname)
  );
}
export const HagermanDonorSchema = z
  .object({
    id: nativeId,
    url: donorUrl,
    stock: scalar.nullable(),
    title: scalar,
    year: scalar,
    make: scalar,
    model: scalar,
    vin: scalar,
    owner: scalar,
    condition: scalar.nullable(),
    partModel: scalar.nullable(),
    imageUrl: z.string().max(2000).nullable(),
  })
  .strict()
  .refine(
    (donor) =>
      donorId(donor.url) === donor.id &&
      (donor.imageUrl === null || imageMatches(donor.imageUrl, donor.id)),
  );
export type HagermanDonor = z.infer<typeof HagermanDonorSchema>;

function parseDonor(raw: string, member: HagermanMember): HagermanDonor {
  const canonicals = [
    ...stripInventoryRawText(raw).matchAll(/<link\b[^>]*>/gi),
  ].filter(([tag]) => inventoryHtmlAttribute(tag, "rel") === "canonical");
  if (
    canonicals.length !== 1 ||
    inventoryHtmlAttribute(canonicals[0]?.[0] ?? "", "href") !==
      member.url.replace(/\/$/, "")
  )
    throw new Error(
      "Hagerman primary detail canonical identity disagrees with opening membership",
    );
  const body = article(raw, "post-72");
  const section = one(
    divs(body, (tag) => classes(tag).includes("e72-e18")),
    "primary detail section",
  );
  const values = fields(section, "e72-e43", "e72-e45");
  if (
    [...values.keys()].some(
      (key) =>
        ![
          "Condition",
          "Part Model",
          "Vehicle Make",
          "Vehicle Model",
          "Year",
          "VIN",
          "Category",
        ].includes(key),
    )
  )
    throw new Error("Unassessed Hagerman primary detail field");
  const title = one(scalarBlocks(section, "e72-e21"), "detail title");
  if (!title.endsWith(" Dismantled Vehicles"))
    throw new Error("Hagerman detail left donor scope");
  const tags = scalarBlocks(section, "e72-e20");
  if (tags.length > 1) throw new Error("Ambiguous Hagerman native tag");
  const image =
    [...body.matchAll(/<img\b[^>]*>/gi)]
      .filter(([tag]) => classes(tag).includes("htp_img"))
      .map(([tag]) => text(inventoryHtmlAttribute(tag, "src") ?? ""))
      .find((value) => imageMatches(value, member.id)) ?? null;
  return HagermanDonorSchema.parse({
    id: member.id,
    url: member.url,
    title,
    stock: stock((tags[0] ?? "").replace(/^Tag #:\s*/, "")),
    year: values.get("Year") ?? "",
    make: values.get("Vehicle Make") ?? "",
    model: values.get("Vehicle Model") ?? "",
    vin: values.get("VIN") ?? "",
    owner: one(
      divs(section, (tag) => classes(tag).includes("e72-e34")).map(text),
      "native owner destination",
    ),
    condition: values.get("Condition") || null,
    partModel: values.get("Part Model") || null,
    imageUrl: image,
  });
}
function parseProfile(raw: string): string {
  const body = text(article(raw, "post-21"));
  const identity =
    "Umatilla Office 82891 Bud Draper Rd Umatilla, OR 97882 Phone: 541-922-6455 Toll-Free: 866-922-6455 Email: office@hagermanparts.com Salem Office 11000 Portland Road NE Salem, OR 97305 Phone: 503-289-0637";
  if (
    !body.includes("Contact Hagerman, Inc.") ||
    !body.includes(identity) ||
    !body.includes("We are a family owned and operated business.")
  )
    throw new Error(
      "Hagerman native operator identity, ownership or physical locations changed",
    );
  return createHash("sha256")
    .update(identity + " Hagerman, Inc. family owned and operated")
    .digest("hex");
}
export const HagermanCatalog = { parse: parseCatalog, donorId } as const;
export const HagermanDonor = { parse: parseDonor } as const;
export const HagermanProfile = { parse: parseProfile } as const;
