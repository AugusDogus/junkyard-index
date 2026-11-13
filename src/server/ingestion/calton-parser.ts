import { createHash } from "node:crypto";
import { inventoryHtmlAttribute } from "./inventory-html";
import {
  caltonAttribute,
  caltonClass,
  caltonContinuations,
  caltonDocument,
  caltonElements,
  caltonOwnedUrl,
  caltonRegion,
  caltonText,
} from "./calton-html";
import {
  CaltonContextSchema,
  CaltonControlSchema,
  CaltonRecordSchema,
  type CaltonContext,
  type CaltonControl,
  type CaltonRecord,
} from "./calton-record";

export interface CaltonError {
  tag: "CaltonParseError";
  operation: string;
  message: string;
}
export type CaltonResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CaltonError };
function boundary<T>(operation: string, run: () => T): CaltonResult<T> {
  try {
    return { ok: true, value: run() };
  } catch (cause) {
    return {
      ok: false,
      error: {
        tag: "CaltonParseError",
        operation,
        message: `Calton ${operation}: ${cause instanceof Error ? cause.message : String(cause)}. Prior inventory is preserved; inspect the saved native response before resuming.`,
      },
    };
  }
}
const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");
const markers = (html: string, name: string) =>
  [...html.matchAll(/<[a-z][\w-]*\b[^>]*>/gi)].filter(([tag]) =>
    caltonClass(tag, name),
  ).length;
const browse = (raw: string, depth: 2 | 3) => {
  const url = caltonOwnedUrl(raw);
  return url &&
    url.pathname.split("/").length === depth + 1 &&
    /^\/parts\/[^/]+(?:\/[^/]+)?$/.test(url.pathname)
    ? url.pathname
    : null;
};
export type CaltonDirectoryContext =
  | { kind: "makes"; sourceUrl: string }
  | { kind: "models"; sourceUrl: string; make: CaltonControl };
export interface CaltonDirectory {
  sourceUrl: string;
  controls: CaltonControl[];
  continuationControls: string[];
  bodyHash: string;
}

export function parseCaltonDirectory(
  raw: string,
  context: CaltonDirectoryContext,
): CaltonResult<CaltonDirectory> {
  return boundary("native " + context.kind + " menu", () => {
    const source = caltonOwnedUrl(context.sourceUrl);
    if (
      !source ||
      (context.kind === "makes"
        ? source.pathname !== "/parts/"
        : browse(context.make.literal, 2) !== context.make.path ||
          source.pathname !== context.make.path)
    )
      throw new Error("Menu source is outside its literal owned parent");
    if (context.kind === "models") CaltonControlSchema.parse(context.make);
    const html = caltonDocument(raw, source);
    if (markers(html, "aps-la-card-premium"))
      throw new Error("Menu gained unclassified native donor cards");
    const inventory = caltonRegion(html, (tag) =>
      context.kind === "makes"
        ? caltonClass(tag, "iisMakesMenu")
        : caltonAttribute(tag, "id") === "menumodellist",
    );
    const controls = caltonElements(inventory, "a").map(({ tag, body }) => {
      const labels = caltonElements(body, "span", (tag) =>
        caltonClass(tag, "aps-make-link__label"),
      );
      const counts = caltonElements(body, "span", (tag) =>
        caltonClass(tag, "aps-make-link__count"),
      );
      const literal = caltonAttribute(tag, "href") ?? "";
      const path = browse(literal, context.kind === "makes" ? 2 : 3);
      const label = caltonText(labels[0]?.body ?? ""),
        count = caltonText(counts[0]?.body ?? "");
      if (
        labels.length !== 1 ||
        counts.length !== 1 ||
        !/^\d+$/.test(count) ||
        !path ||
        (context.kind === "models" && !path.startsWith(context.make.path + "/"))
      )
        throw new Error(
          "Native menu control has a malformed label, count, destination or parent; no control was omitted",
        );
      return CaltonControlSchema.parse({
        path,
        literal,
        label,
        count: Number(count),
      });
    });
    if (
      !controls.length ||
      controls.length > 1000 ||
      new Set(controls.map((control) => control.path)).size !== controls.length
    )
      throw new Error(
        "Native menu is missing, oversized or repeats a literal destination",
      );
    return {
      sourceUrl: source.href,
      controls,
      continuationControls: caltonContinuations(html),
      bodyHash: hash(raw),
    };
  });
}
export interface CaltonPage {
  sourceUrl: string;
  context: CaltonContext;
  bytes: number;
  bodyHash: string;
  records: CaltonRecord[];
  continuationControls: string[];
  nativeEmptyResult: string | null;
  countCheck:
    | { kind: "unbound" }
    | { kind: "matches" | "mismatch"; advertised: number; observed: number };
}
const optionalAttribute = (tag: string, name: string) => {
  try {
    return caltonAttribute(tag, name);
  } catch {
    return null;
  }
};

/** A page observation only. Counts and unread controls remain explicit for traversal. */
export function parseCaltonPage(
  raw: string,
  input: CaltonContext,
): CaltonResult<CaltonPage> {
  return boundary("native donor page", () => {
    const context = CaltonContextSchema.parse(input),
      source = caltonOwnedUrl(context.sourceUrl);
    if (
      !source ||
      (context.kind === "arrivals"
        ? source.pathname !== "/"
        : browse(context.make.literal, 2) !== context.make.path ||
          browse(context.model.literal, 3) !== context.model.path ||
          !context.model.path.startsWith(context.make.path + "/") ||
          source.pathname !== context.model.path)
    )
      throw new Error(
        "Donor page lacks an owned literal source and published parent",
      );
    const html = caltonDocument(raw, source);
    const inventory =
      context.kind === "model"
        ? caltonRegion(html, (tag) => caltonAttribute(tag, "id") === "iiscont")
        : caltonRegion(html, (tag) => caltonClass(tag, "aps-la-grid"));
    const cards = caltonElements(inventory, "div", (tag) =>
      caltonClass(tag, "aps-la-card-premium"),
    );
    const emptyMessages = caltonElements(inventory, "div", (tag) =>
      caltonClass(tag, "aps-no-results__message"),
    );
    const nativeEmptyResult =
      context.kind === "model" &&
      emptyMessages.length === 1 &&
      caltonText(emptyMessages[0]?.body ?? "") ===
        "No Results.. Try Browsing Our Parts Or Search Again"
        ? caltonText(emptyMessages[0]?.body ?? "")
        : null;
    if (
      (!cards.length && nativeEmptyResult === null) ||
      (cards.length > 0 && emptyMessages.length > 0) ||
      markers(html, "aps-la-card-premium") !== cards.length ||
      markers(html, "aps-la-car-details") !== cards.length ||
      markers(html, "aps-la-card-link-premium") !== cards.length
    )
      throw new Error(
        "Native donor cards, identity regions and card links do not reconcile; no empty result was inferred",
      );
    const records = cards.map((card, ordinal) => {
      const links = caltonElements(card.body, "a", (tag) =>
        caltonClass(tag, "aps-la-card-link-premium"),
      );
      const link = links[0];
      if (links.length !== 1 || !link)
        throw new Error(
          "Donor does not have exactly one complete native card destination",
        );
      const details = caltonRegion(link.body, (tag) =>
        caltonClass(tag, "aps-la-car-details"),
      );
      const fields = caltonElements(details, "div", (tag) =>
        caltonClass(tag, "aps-la-stat-premium"),
      ).flatMap(({ body }) => {
        const labels = caltonElements(body, "div", (tag) =>
          caltonClass(tag, "aps-la-stat-label"),
        );
        const values = caltonElements(body, "div", (tag) =>
          caltonClass(tag, "aps-la-stat-value"),
        );
        return labels.flatMap((label) =>
          values.map((value) => ({
            label: caltonText(label.body).toLowerCase(),
            value: caltonText(value.body),
          })),
        );
      });
      const years = caltonElements(details, "div", (tag) =>
        caltonClass(tag, "aps-la-right-val-premium"),
      ).flatMap(({ body }) => {
        const labels = caltonElements(body, "span", (tag) =>
          caltonClass(tag, "aps-la-field-label"),
        );
        return labels.length === 1 &&
          caltonText(labels[0]?.body ?? "") === "Year"
          ? [caltonText(body.replace(/<span\b[^>]*>[\s\S]*?<\/span\s*>/gi, ""))]
          : [];
      });
      const titles = caltonElements(details, "h3", (tag) =>
        caltonClass(tag, "aps-la-title-premium"),
      ).map(({ body }) => caltonText(body));
      const vins = caltonElements(details, "p", (tag) =>
        caltonClass(tag, "aps-la-subtitle-premium--vin"),
      ).map(({ body }) => caltonText(body).replace(/^VIN:\s*/i, ""));
      const destinations = caltonElements(card.body, "a")
        .filter(
          ({ tag, body }) =>
            caltonClass(tag, "aps-la-card-link-premium") ||
            caltonClass(tag, "aps-la-parts-btn") ||
            /^See Parts\b/i.test(caltonText(body)),
        )
        .map(({ tag }) => {
          const literal = inventoryHtmlAttribute(tag, "href");
          return {
            literal,
            url:
              literal === null
                ? null
                : (URL.parse(caltonText(literal), source.href)?.href ?? null),
          };
        });
      const images = [...card.body.matchAll(/<img\b[^>]*>/gi)].map(([tag]) =>
        optionalAttribute(tag, "src"),
      );
      return CaltonRecordSchema.parse({
        sourceUrl: source.href,
        context,
        ordinal,
        cardId: optionalAttribute(card.tag, "id"),
        years,
        titles,
        vins,
        fields,
        destinations,
        images,
      });
    });
    return {
      sourceUrl: source.href,
      context,
      bytes: Buffer.byteLength(raw),
      bodyHash: hash(raw),
      records,
      continuationControls: caltonContinuations(html),
      nativeEmptyResult,
      countCheck:
        context.kind === "arrivals"
          ? { kind: "unbound" }
          : {
              kind:
                records.length === context.model.count ? "matches" : "mismatch",
              advertised: context.model.count,
              observed: records.length,
            },
    };
  });
}
