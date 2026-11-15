import { createHash } from "node:crypto";
import { z } from "zod";
import {
  northwestBrowsePath,
  northwestDocument,
  NORTHWEST_ORIGIN,
} from "./northwest-html";
import { NorthwestRecordSchema } from "./northwest-record";
import {
  prattAttribute as attribute,
  prattClass as hasClass,
  prattElements as elements,
  prattText as text,
  prattContinuation as continuation,
} from "./pratt-html";
import { NORTHWEST_MAKES } from "./northwest-yard-metadata";

export const northwestHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const NorthwestControlSchema = z
  .object({
    path: z.string().min(1).max(300),
    label: z.string().min(1).max(100),
    count: z.number().int().min(0).max(20000),
  })
  .strict();
export type NorthwestControl = z.infer<typeof NorthwestControlSchema>;
export const NorthwestPageSchema = z
  .object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    records: z.array(NorthwestRecordSchema).max(1000),
  })
  .strict();
export type NorthwestPage = z.infer<typeof NorthwestPageSchema>;

function document(raw: string) {
  const result = northwestDocument(raw, { maximumBytes: 2 * 1024 * 1024 });
  if (!result.ok) throw new Error(result.error.message);
  const html = result.value;
  if (
    continuation(html).length ||
    /\bdata-(?:page|next|cursor)\s*=/i.test(html)
  )
    throw new Error(
      "Northwest has unread native continuation; preserve prior inventory and classify the published control",
    );
  if (/aps-la-card-premium/.test(html))
    throw new Error("Northwest publishes an unclassified donor surface");
  return html;
}
export function parseNorthwestRoot(raw: string): string {
  const html = document(raw);
  if (
    !elements(html, "a").some(
      (a) =>
        URL.parse(attribute(a.tag, "href") ?? "", NORTHWEST_ORIGIN)?.href ===
        NORTHWEST_MAKES,
    )
  )
    throw new Error("Northwest native make directory entry is missing");
  return northwestHash([
    "AK01",
    "5700 Camelot Drive",
    "Anchorage",
    "AK",
    "99504",
  ]);
}
export function parseNorthwestDirectory(
  raw: string,
  kind: "makes" | "models",
  parent?: NorthwestControl,
): NorthwestControl[] {
  const html = document(raw);
  if (elements(html, "div", (tag) => hasClass(tag, "card-price")).length)
    throw new Error("Northwest directory has an unclassified donor surface");
  const links = elements(html, "a", (tag) => hasClass(tag, "iis-center-block"));
  const controls = links.map((link) => {
    const badges = elements(link.body, "span", (tag) => hasClass(tag, "badge"));
    const badge = badges[0];
    const path = northwestBrowsePath(
      attribute(link.tag, "href") ?? "",
      kind === "makes" ? 1 : 2,
    );
    if (
      !path ||
      badges.length !== 1 ||
      !badge ||
      !/^\d+$/.test(text(badge.body)) ||
      (parent && !path.startsWith(parent.path.replace(/\/$/, "") + "/"))
    )
      throw new Error(
        "Northwest published directory path, badge or make binding changed",
      );
    return NorthwestControlSchema.parse({
      path,
      label: text(link.body.replace(/<span\b[^>]*>[\s\S]*?<\/span>/gi, "")),
      count: Number(text(badge.body)),
    });
  });
  if (
    !controls.length ||
    controls.length > (kind === "makes" ? 64 : 128) ||
    new Set(controls.map((c) => c.path)).size !== controls.length
  )
    throw new Error(
      "Northwest directory is empty, oversized or repeats a native destination",
    );
  return controls;
}
export function parseNorthwestModel(
  raw: string,
  make: NorthwestControl,
  model: NorthwestControl,
): NorthwestPage {
  const html = document(raw);
  const normal = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, "");
  // The native heading removes repeated make text, including SAFARI (GMC).
  // Required donor claims still use the complete published model label.
  const route = model.path.replace(/\/$/, "").split("/").at(-1) ?? "";
  if (
    !model.path.startsWith(make.path.replace(/\/$/, "") + "/") ||
    !elements(html, "h1").some(
      (h) =>
        normal(text(h.body)).includes(normal(make.label)) &&
        [model.label, route].some(
          (label) =>
            normal(text(h.body)).includes(normal(label)) ||
            (normal(label).replaceAll(normal(make.label), "").length > 0 &&
              normal(text(h.body))
                .replaceAll(normal(make.label), "")
                .includes(normal(label).replaceAll(normal(make.label), ""))),
        ),
    )
  )
    throw new Error(
      "Northwest model heading is not bound to its published make/model control",
    );
  const blocks = elements(html, "div", (tag) => hasClass(tag, "card-price"));
  if (
    blocks.length > 1000 ||
    elements(html, "div", (tag) => hasClass(tag, "car-details")).length !==
      blocks.length ||
    (!blocks.length &&
      !text(html).includes(
        "No Results Found. Try Browsing Our Parts Or Search Again",
      ))
  )
    throw new Error(
      "Northwest native donor universe is unclassified, incomplete or oversized",
    );
  const records = blocks.map((block, index) => {
    const details = elements(block.body, "div", (tag) =>
      hasClass(tag, "car-details"),
    );
    if (details.length !== 1)
      throw new Error(
        "Northwest donor lacks one complete labelled identity region",
      );
    const claims = [
      ...(details[0]?.body ?? "").matchAll(
        /<b\b[^>]*>([\s\S]*?)<\/b\s*>([\s\S]*?)(?=<br\s*\/?>|$)/gi,
      ),
    ];
    const values = (label: RegExp) =>
      claims
        .filter((c) => label.test(text(c[1] ?? "")))
        .map((c) => text(c[2] ?? ""));
    const anchors = elements(block.body, "a");
    const destinations = anchors
      .filter(
        (a) =>
          /^see parts$/i.test(text(a.body)) ||
          (URL.parse(
            attribute(a.tag, "href") ?? "",
            NORTHWEST_ORIGIN,
          )?.pathname.split("/").length === 6 &&
            URL.parse(attribute(a.tag, "href") ?? "", NORTHWEST_ORIGIN)
              ?.origin === NORTHWEST_ORIGIN),
      )
      .map((a) => attribute(a.tag, "href") ?? "");
    return NorthwestRecordSchema.parse({
      occurrenceId: model.path + "#" + index,
      sourceUrl: NORTHWEST_ORIGIN + model.path,
      context: {
        kind: "model",
        make: { path: make.path, label: make.label },
        model: { path: model.path, label: model.label },
      },
      years: values(/^Year\s*:/i),
      titles: values(/^Make\/Model\s*:/i),
      vins: values(/^Vin\s*:/i),
      stockNumbers: values(/^Stock\s*:/i),
      destinations,
      inquiries: elements(block.body, "button").flatMap((b) => {
        const v = attribute(b.tag, "data-vehicle");
        return v === null ? [] : [v];
      }),
      imageUrls: [...block.body.matchAll(/<img\b[^>]*>/gi)].flatMap(([tag]) => {
        const v = attribute(tag, "data-src") ?? attribute(tag, "src");
        return v === null ? [] : [v];
      }),
      availableDates: values(/^Enter Date\s*:/i),
    });
  });
  return { records, hash: northwestHash(records) };
}
