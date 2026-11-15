import { createHash } from "node:crypto";
import { z } from "zod";
import {
  DentonCatalog,
  type DentonControl,
  type DentonPage,
} from "./denton-catalog";
import {
  DENTON_ABOUT,
  DENTON_CONTACT,
  DENTON_MAX_BODY_BYTES,
} from "./denton-client";
import {
  dentonDocument,
  dentonElements,
  dentonAttribute,
  dentonText,
} from "./denton-html";
import {
  DENTON_ARRIVALS,
  DENTON_MAKES,
  DENTON_YARD,
} from "./denton-yard-metadata";

export const dentonHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const bytes = z.number().int().min(0).max(DENTON_MAX_BODY_BYTES);
export const DentonRedirectSchema = z
  .object({ url: z.string(), target: z.string(), bytes, bodyHash: hash })
  .strict();
const receipt = z
  .object({
    url: z.string(),
    bytes: bytes.min(1),
    bodyHash: hash,
    redirect: DentonRedirectSchema.nullable(),
  })
  .strict();
const control = z
  .object({
    url: z.string().max(2048),
    label: z.string().min(1).max(256),
    count: z.number().int().nonnegative().safe(),
  })
  .strict();
const controls = z.array(control).min(1).max(1024);
const record = z
  .object({
    fields: z
      .array(
        z
          .object({ label: z.string().max(256), value: z.string().max(4096) })
          .strict(),
      )
      .max(128),
    destinations: z.array(z.string().max(4096).nullable()).max(128),
    images: z.array(z.string().max(4096).nullable()).max(128),
  })
  .strict();
const page = z
  .object({ records: z.array(record).max(499), nativeEmpty: z.boolean() })
  .strict();
export const DentonEntrySchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.enum(["about", "contact"]), receipt, identity: hash })
    .strict(),
  z.object({ kind: z.enum(["makes", "menu"]), receipt, controls }).strict(),
  z.object({ kind: z.enum(["model", "arrivals"]), receipt, page }).strict(),
]);
export type DentonEntry = z.infer<typeof DentonEntrySchema>;
export type DentonTask =
  | { kind: "about" | "contact" | "makes" | "arrivals"; url: string }
  | { kind: "menu"; url: string; make: DentonControl }
  | { kind: "model"; url: string; make: DentonControl; model: DentonControl };

const fixed: DentonTask[] = [
  { kind: "about", url: DENTON_ABOUT },
  { kind: "contact", url: DENTON_CONTACT },
  { kind: "makes", url: DENTON_MAKES },
];
/** Tasks extend only from the actual published opening controls. */
export function dentonTasks(opening: readonly DentonEntry[]): DentonTask[] {
  const makes = opening[2];
  if (makes?.kind !== "makes") return fixed;
  const menus: DentonTask[] = makes.controls.map((make) => ({
    kind: "menu",
    url: make.url,
    make,
  }));
  const models: DentonTask[] = [];
  for (const [index, make] of makes.controls.entries()) {
    const menu = opening[index + 3];
    if (menu?.kind !== "menu") return [...fixed, ...menus];
    models.push(
      ...menu.controls.map(
        (model): DentonTask => ({ kind: "model", url: model.url, make, model }),
      ),
    );
  }
  return [
    ...fixed,
    ...menus,
    ...models,
    { kind: "arrivals", url: DENTON_ARRIVALS },
  ];
}
export function dentonMakes(opening: readonly DentonEntry[]) {
  const entry = opening[2];
  return entry?.kind === "makes" ? entry.controls : [];
}
export function dentonPage(
  entry: DentonEntry,
  task: DentonTask,
  opening: readonly DentonEntry[],
): DentonPage {
  if (
    (entry.kind !== "model" && entry.kind !== "arrivals") ||
    (task.kind !== "model" && task.kind !== "arrivals")
  )
    throw new Error("Donor page lost its published context");
  const context =
    task.kind === "model"
      ? ({ kind: "model", make: task.make, model: task.model } as const)
      : ({ kind: "arrivals", makes: dentonMakes(opening) } as const);
  return {
    ...entry.page,
    records: entry.page.records.map((row, ordinal) => ({
      ...row,
      ordinal,
      context,
    })),
  };
}
export function dentonFingerprint(entry: DentonEntry) {
  if (entry.kind === "makes" || entry.kind === "menu")
    return dentonHash(entry.controls.map(({ url, label }) => ({ url, label })));
  if (entry.kind === "about" || entry.kind === "contact") return entry.identity;
  if ("page" in entry) return dentonHash(entry.page);
  throw new Error("Native entry has no semantic fingerprint");
}
function identity(raw: string, kind: "about" | "contact") {
  const html = dentonDocument(raw),
    text = dentonText(html);
  if (kind === "about") {
    if (
      !text.includes(
        "all of our inventory to our Carbondale store at 14580 S Topeka Ave in Carbondale KS 66414",
      ) ||
      !text.includes(
        "Denton Auto Salvage is a second-generation family-owned business established in 1965",
      )
    )
      throw new Error(
        "Native own-yard inventory and operator assertion changed",
      );
  } else {
    const maps = dentonElements(html, "iframe").map(
      (frame) => dentonAttribute(frame.tag, "src") ?? "",
    );
    if (
      !/14580 South Topeka Ave/.test(text) ||
      !/Carbondale,? KS 66414/.test(text) ||
      !text.includes(DENTON_YARD.phone) ||
      !maps.some(
        (url) =>
          url.startsWith("https://www.google.com/maps/embed?") &&
          url.includes("!2d-95.686134!3d38.80331100000001!") &&
          url.includes("Denton%20Auto%20Salvage%20Inc"),
      )
    )
      throw new Error("Native address, phone or named map coordinates changed");
  }
  return dentonHash({ kind, yard: DENTON_YARD });
}
export function dentonParseEntry(
  raw: string,
  task: DentonTask,
  evidence: DentonEntry["receipt"],
  opening: readonly DentonEntry[],
): DentonEntry {
  if (task.kind === "about" || task.kind === "contact")
    return {
      kind: task.kind,
      receipt: evidence,
      identity: identity(raw, task.kind),
    };
  if (task.kind === "makes" || task.kind === "menu") {
    const result = DentonCatalog.directory(
      raw,
      task.kind === "menu" ? task.make : undefined,
    );
    if (!result.ok) throw new Error(result.error.message);
    return { kind: task.kind, receipt: evidence, controls: result.value };
  }
  const result =
    task.kind === "model"
      ? DentonCatalog.model(raw, task)
      : DentonCatalog.arrivals(raw, dentonMakes(opening));
  if (!result.ok) throw new Error(result.error.message);
  return {
    kind: task.kind,
    receipt: evidence,
    page: {
      nativeEmpty: result.value.nativeEmpty,
      records: result.value.records.map(({ fields, destinations, images }) => ({
        fields,
        destinations,
        images,
      })),
    },
  };
}

export function dentonValidateEntry(entry: DentonEntry, task: DentonTask) {
  if (entry.kind !== task.kind)
    throw new Error("Checkpoint is not a contiguous literal traversal prefix");
  if (entry.kind === "makes" || entry.kind === "menu") {
    const parent =
      task.kind === "menu"
        ? new URL(task.make.url).pathname.replace(/\/$/, "")
        : "/used-parts";
    if (
      new Set(entry.controls.map((c) => c.url)).size !==
        entry.controls.length ||
      entry.controls.some((c) => {
        const url = URL.parse(c.url);
        return (
          !url ||
          url.origin !== "https://dentonauto.com" ||
          url.username ||
          url.password ||
          url.hash ||
          url.search ||
          !url.pathname.startsWith(parent + "/") ||
          url.pathname.slice(parent.length + 1).replace(/\/$/, "").length ===
            0 ||
          url.pathname
            .slice(parent.length + 1)
            .replace(/\/$/, "")
            .includes("/")
        );
      })
    )
      throw new Error(
        "Checkpoint loses literal ownership or parent/control uniqueness",
      );
  } else if (entry.kind === "model" || entry.kind === "arrivals") {
    if (entry.page.nativeEmpty !== (entry.page.records.length === 0))
      throw new Error(
        "Checkpoint native empty evidence contradicts its donor rows",
      );
  } else if (
    "identity" in entry &&
    entry.identity !== dentonHash({ kind: entry.kind, yard: DENTON_YARD })
  )
    throw new Error("Checkpoint ownership/geography assertion changed");
}
