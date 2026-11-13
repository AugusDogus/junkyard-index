import { createHash } from "node:crypto";
import { z } from "zod";
import { inventoryHtmlAttribute } from "./inventory-html";
import {
  six03Class,
  six03Continuations,
  six03Divs,
  six03Document,
  six03Text,
} from "./six03-html";
import {
  SIX03_CATALOG,
  SIX03_CONTACT,
  SIX03_ORIGIN,
  six03DonorPath,
} from "./six03-yard-metadata";

export const six03Hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const rawHash = (raw: string) => createHash("sha256").update(raw).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const path = z
  .string()
  .max(250)
  .refine((value) => six03DonorPath(SIX03_ORIGIN + value) === value);
const text = z.string().max(500);
export const Six03PostSchema = z.tuple([
  path,
  text,
  z.string().max(4),
  text,
  text,
]);
export type Six03Post = z.infer<typeof Six03PostSchema>;
const requiredLabel = z.enum(["VIN", "Year / Make / Model"]);
const optionalLabel = z.enum([
  "Stock #",
  "Engine",
  "Transmission",
  "Exterior Color",
  "Trim Level",
]);
const FieldSchema = z.union([
  z.tuple([requiredLabel, text]),
  z.tuple([optionalLabel, text.nullable()]),
]);
// Retain literal claims, not materialized vehicles. Repeated VIN and YMM rows
// remain visible to all-occurrence quarantine before any duplicate selection.
const detail = z
  .object({
    hash,
    projection: hash,
    path,
    kind: z.enum(["article", "excerpt"]),
    fields: z.array(FieldSchema).max(40),
    headings: z.array(text).min(1).max(5),
    image: z.string().max(1000).nullable(),
  })
  .strict();
export type Six03Detail = z.infer<typeof detail>;
const detailProjection = (value: Six03Detail) =>
  six03Hash([
    value.hash,
    value.path,
    value.kind,
    value.fields,
    value.headings,
    value.image,
  ]);
export const Six03DetailSchema = detail.superRefine((value, context) => {
  if (value.projection !== detailProjection(value))
    context.addIssue({
      code: "custom",
      message: "603 native detail projection changed",
    });
});
const catalog = z
  .object({
    hash,
    projection: hash,
    runtime: hash,
    posts: z.array(Six03PostSchema).min(1).max(1200),
    embedded: z.array(Six03DetailSchema).max(20),
  })
  .strict();
export type Six03Catalog = z.infer<typeof catalog>;
const catalogProjection = (value: Six03Catalog) =>
  six03Hash([value.hash, value.runtime, value.posts, value.embedded]);
export const Six03CatalogSchema = catalog.superRefine((value, context) => {
  const paths = new Set(value.posts.map((post) => post[0]));
  if (
    value.projection !== catalogProjection(value) ||
    paths.size !== value.posts.length ||
    new Set(value.embedded.map((row) => row.path)).size !==
      value.embedded.length ||
    value.embedded.some((row) => row.kind !== "excerpt" || !paths.has(row.path))
  )
    context.addIssue({
      code: "custom",
      message: "603 catalog projection or embedded membership changed",
    });
});

export const six03Field = (
  record: Six03Detail,
  label: z.infer<typeof requiredLabel>,
) =>
  record.fields.flatMap(([key, value]) =>
    key === label && value !== null ? [value] : [],
  );
export const six03OptionalField = (
  record: Six03Detail,
  label: z.infer<typeof optionalLabel>,
) => record.fields.filter(([key]) => key === label).map(([, value]) => value);

function sealDetail(value: Omit<Six03Detail, "projection">): Six03Detail {
  const candidate = { ...value, projection: "0".repeat(64) };
  return Six03DetailSchema.parse({
    ...candidate,
    projection: detailProjection(candidate),
  });
}
const optionalProjection = (value: string): string | null =>
  value.trim().length <= 500 ? value.trim() : null;

function completeMain(html: string): string {
  const matches = [...html.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/gi)];
  if (matches.length !== 1 || [...html.matchAll(/<\/?main\b/gi)].length !== 2)
    throw new Error("603 expected one complete native donor main");
  return matches[0]?.[1] ?? "";
}

function terminal(html: string) {
  for (const match of html.matchAll(
    /(<(?:a|button)\b[^>]*>)([\s\S]*?)<\/(?:a|button)\s*>/gi,
  )) {
    const tag = match[1] ?? "";
    if (
      inventoryHtmlAttribute(tag, "id") === "pv-load-btn" &&
      inventoryHtmlAttribute(tag, "onclick") === "pvLoadMore()"
    )
      continue;
    if (
      /next|prev/i.test(inventoryHtmlAttribute(tag, "rel") ?? "") ||
      /paginat|load.?more|page-link/i.test(
        inventoryHtmlAttribute(tag, "class") ?? "",
      ) ||
      /^(?:next|load more|see more|older|newer)\b/i.test(
        six03Text(match[2] ?? ""),
      )
    )
      throw new Error(
        "603 native continuation changed; inspect the complete donor graph",
      );
  }
}

export function parseSix03Catalog(raw: string): Six03Catalog {
  const html = six03Document(raw, SIX03_CATALOG);
  const archives = six03Divs(
    html,
    (tag) => inventoryHtmlAttribute(tag, "id") === "pv-custom-archive",
  );
  const archive = archives[0];
  const runtimes = [...raw.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)]
    .map((match) => match[1] ?? "")
    .filter((script) => script.includes('getElementById("pv-custom-archive")'));
  const runtime = runtimes[0] ?? "";
  if (
    archives.length !== 1 ||
    !archive ||
    runtimes.length !== 1 ||
    !runtime.includes(
      'm.innerHTML="";m.appendChild(a);a.style.display="block"',
    ) ||
    !runtime.includes("var PV_PER=24;var PV_MORE=12;") ||
    !runtime.includes("function pvLoadMore()") ||
    !runtime.includes("if(added>=12)break") ||
    /\b(?:fetch|XMLHttpRequest|ajax)\b/.test(runtime)
  )
    throw new Error(
      "603 complete local reveal graph changed; do not follow discarded WordPress pagination",
    );
  terminal(archive.body);
  const posts = six03Divs(archive.body, (tag) =>
    six03Class(tag, "pv-card"),
  ).map(({ tag, body }) => {
    const headings = [...body.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3\s*>/gi)];
    const anchors = [...body.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a\s*>/gi)];
    const destinations = anchors.map((match) =>
      six03Text(inventoryHtmlAttribute(match[1] ?? "", "href") ?? ""),
    );
    const destination = destinations[0] ?? "";
    if (
      headings.length !== 1 ||
      anchors.length !== 2 ||
      destinations.some((url) => url !== destination) ||
      !six03DonorPath(destination) ||
      !six03Text(headings[0]?.[1] ?? "")
    )
      throw new Error(
        "603 native card heading or owned destination is ambiguous",
      );
    return Six03PostSchema.parse([
      six03DonorPath(destination),
      six03Text(inventoryHtmlAttribute(tag, "data-make") ?? ""),
      six03Text(inventoryHtmlAttribute(tag, "data-year") ?? ""),
      six03Text(inventoryHtmlAttribute(tag, "data-title") ?? ""),
      six03Text(headings[0]?.[1] ?? ""),
    ]);
  });
  const counts = [
    ...archive.body.matchAll(/<span\b[^>]*>\s*(\d+) Vehicles\s*<\/span>/gi),
  ];
  const load = [...archive.body.matchAll(/<button\b[^>]*>/gi)].filter(
    ([tag]) => inventoryHtmlAttribute(tag, "id") === "pv-load-btn",
  );
  if (
    counts.length !== 1 ||
    Number(counts[0]?.[1]) !== posts.length ||
    load.length !== 1 ||
    [...html.matchAll(/<div\b[^>]*>/gi)].filter(([tag]) =>
      six03Class(tag, "pv-card"),
    ).length !== posts.length
  )
    throw new Error(
      "603 native count, card coverage or local reveal control changed",
    );
  const main = completeMain(html);
  six03Continuations(html, main);
  const embedded: Six03Detail[] = [];
  for (const match of main.matchAll(
    /<article\b[^>]*>([\s\S]*?)<\/article\s*>/gi,
  )) {
    const body = match[1] ?? "";
    const headings = [...body.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/gi)];
    const anchors = [...(headings[0]?.[1] ?? "").matchAll(/<a\b[^>]*>/gi)];
    const destination = six03Text(
      inventoryHtmlAttribute(anchors[0]?.[0] ?? "", "href") ?? "",
    );
    const donorPath = six03DonorPath(destination);
    const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)];
    const plain = six03Text(paragraphs[0]?.[1] ?? "");
    if (
      !donorPath ||
      !posts.some((post) => post[0] === donorPath) ||
      headings.length !== 1 ||
      anchors.length !== 1 ||
      paragraphs.length !== 1
    )
      throw new Error(
        "603 embedded article destination or excerpt boundary changed",
      );
    const unit =
      /Unit Data Stock # (.*?) VIN(?: (.*?))? Mileage .*? Year \/ Make \/ Model (.*?) Engine(.*?) Transmission(.*?) Exterior Color(.*?) Drive Type/.exec(
        plain,
      );
    const nativeHeading = plain.split(" | Vehicle Record")[0] ?? "";
    if (!unit || !nativeHeading || !plain.includes(" | Vehicle Record"))
      throw new Error("603 embedded donor excerpt grammar changed");
    embedded.push(
      sealDetail({
        hash: rawHash(match[0]),
        path: donorPath,
        kind: "excerpt",
        fields: [
          ["Stock #", optionalProjection(unit[1] ?? "")],
          ["VIN", (unit[2] ?? "").trim()],
          ["Year / Make / Model", (unit[3] ?? "").trim()],
          ["Engine", optionalProjection(unit[4] ?? "")],
          ["Transmission", optionalProjection(unit[5] ?? "")],
          ["Exterior Color", optionalProjection(unit[6] ?? "")],
        ],
        headings: [six03Text(headings[0]?.[1] ?? ""), nativeHeading],
        image: null,
      }),
    );
  }
  // Every donor link must belong to the complete custom grid, including links
  // in the source's displaced archive. No returned-link expansion is allowed.
  for (const [tag] of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = six03Text(inventoryHtmlAttribute(tag, "href") ?? "");
    const url = URL.parse(href, SIX03_ORIGIN);
    if (
      url?.pathname.startsWith("/parts-vehicles/") &&
      url.pathname !== "/parts-vehicles/" &&
      !/^\/parts-vehicles\/page\/\d+\/$/.test(url.pathname) &&
      !posts.some((post) => SIX03_ORIGIN + post[0] === url.href)
    )
      throw new Error(
        "603 donor destination appears outside the published custom grid",
      );
  }
  const candidate = {
    hash: rawHash(raw),
    runtime: rawHash(runtime),
    posts,
    embedded,
    projection: "0".repeat(64),
  };
  return Six03CatalogSchema.parse({
    ...candidate,
    projection: catalogProjection(candidate),
  });
}

export function parseSix03Detail(raw: string, post: Six03Post): Six03Detail {
  Six03PostSchema.parse(post);
  const html = six03Document(raw, SIX03_ORIGIN + post[0]);
  const main = completeMain(html);
  six03Continuations(html, null);
  terminal(main);
  const units = six03Divs(main, (tag) => six03Class(tag, "vr-unit-data"));
  // Ten inspected older articles leave unrelated trailing layout divs open.
  // Bound the donor by its complete main and balanced Unit Data table instead
  // of asking an HTML parser to repair that outer presentation wrapper.
  const containers = [...main.matchAll(/<div\b[^>]*>/gi)].filter(([tag]) =>
    six03Class(tag, "vr-container"),
  );
  const unit = units[0];
  if (units.length !== 1 || !unit || containers.length !== 1)
    throw new Error(
      "603 donor article lacks one complete native Unit Data region",
    );
  if (
    [...unit.body.matchAll(/<table\b/gi)].length !== 1 ||
    [...unit.body.matchAll(/<\/table\s*>/gi)].length !== 1
  )
    throw new Error("603 Unit Data table is truncated or nested");
  const fields: Six03Detail["fields"] = [];
  const optionals = new Map<z.infer<typeof optionalLabel>, (string | null)[]>();
  for (const match of unit.body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    const cells = [
      ...(match[1] ?? "").matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi),
    ];
    if (cells.length !== 2)
      throw new Error("603 Unit Data row changed its two-cell grammar");
    const label = six03Text(cells[0]?.[1] ?? "");
    const value = six03Text(cells[1]?.[1] ?? "");
    const optional = optionalLabel.safeParse(label);
    if (optional.success) {
      optionals.set(optional.data, [
        ...(optionals.get(optional.data) ?? []),
        optionalProjection(value),
      ]);
    } else if (requiredLabel.safeParse(label).success) {
      fields.push(FieldSchema.parse([label, value]));
    }
  }
  for (const [label, values] of optionals) {
    const meaningful = [...new Set(values.filter((value) => value !== ""))];
    // Optional ambiguity or oversize cannot become an identity gate. Preserve
    // the source artifact hash and an explicit unknown optional projection.
    fields.push([
      label,
      meaningful.length === 0
        ? ""
        : meaningful.length === 1
          ? (meaningful[0] ?? null)
          : null,
    ]);
  }
  if (
    [...unit.body.matchAll(/<\/?tr\b/gi)].length !==
      [...unit.body.matchAll(/<tr\b/gi)].length * 2 ||
    fields.filter(([key]) => key === "Year / Make / Model").length === 0 ||
    fields.filter(([key]) => key === "VIN").length === 0
  )
    throw new Error(
      "603 Unit Data contains truncated rows or lost its native identity fields",
    );
  const headers = [...main.matchAll(/(<h1\b[^>]*>)([\s\S]*?)<\/h1\s*>/gi)];
  const entry = headers.filter((match) =>
    six03Class(match[1] ?? "", "entry-title"),
  );
  const primary = headers.filter(
    (match) => !six03Class(match[1] ?? "", "entry-title"),
  );
  if (
    headers.length !== 2 ||
    entry.length !== 1 ||
    primary.length !== 1 ||
    (primary[0]?.index ?? main.length) >= main.indexOf(unit.tag)
  )
    throw new Error(
      "603 native decorated title / primary donor heading boundary changed",
    );
  const headings = [
    six03Text(entry[0]?.[2] ?? ""),
    six03Text(primary[0]?.[2] ?? ""),
  ];
  let malformedImage = false;
  const images = [...main.matchAll(/<img\b[^>]*>/gi)].filter(([tag]) => {
    try {
      return inventoryHtmlAttribute(tag, "id") === "main-vehicle-img";
    } catch {
      malformedImage = true;
      return false;
    }
  });
  let image: string | null = null;
  if (!malformedImage && images.length === 1 && images[0]) {
    try {
      const value = six03Text(
        inventoryHtmlAttribute(images[0][0], "src") ?? "",
      );
      image = value.length <= 1000 ? value : null;
    } catch {
      // A duplicate optional src is unknown metadata, not a donor rejection.
      image = null;
    }
  }
  return sealDetail({
    hash: rawHash(raw),
    path: post[0],
    kind: "article",
    fields,
    headings,
    image,
  });
}

export function parseSix03Contact(raw: string): string {
  const html = six03Document(raw, SIX03_CONTACT);
  const visits = six03Divs(html, (tag) => six03Class(tag, "contact-info-card"))
    .map(({ body }) => six03Text(body))
    .filter((plain) => plain.startsWith("Visit Us"));
  const maps = [...html.matchAll(/<iframe\b[^>]*>/gi)].map(([tag]) =>
    six03Text(inventoryHtmlAttribute(tag, "src") ?? ""),
  );
  const expected =
    "https://maps.google.com/maps?q=603+Auto+Salvage+233+Main+St+Plaistow+NH+03865&t=m&z=15&output=embed&iwloc=near";
  if (
    visits.length !== 1 ||
    !visits[0]?.includes("233 Main St, Plaistow, NH 03865") ||
    !visits[0]?.includes("(603) 392-7313") ||
    maps.length !== 1 ||
    maps[0] !== expected
  )
    throw new Error(
      "603 native Visit Us address, phone or named physical map changed",
    );
  return six03Hash([visits, maps]);
}
