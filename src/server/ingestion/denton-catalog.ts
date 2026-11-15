import {
  dentonAttribute,
  dentonBoundary,
  dentonClass,
  dentonDocument,
  dentonElements,
  dentonOwnedUrl,
  dentonRegion,
  dentonTerminal,
  dentonText,
} from "./denton-html";

export interface DentonControl {
  url: string;
  label: string;
  count: number;
}
export type DentonContext =
  | { kind: "model"; make: DentonControl; model: DentonControl }
  | { kind: "arrivals"; makes: readonly DentonControl[] };
export interface DentonRecord {
  context: DentonContext;
  ordinal: number;
  fields: { label: string; value: string }[];
  destinations: (string | null)[];
  images: (string | null)[];
}
export interface DentonPage {
  records: DentonRecord[];
  nativeEmpty: boolean;
}
function region(raw: string, arrivals = false) {
  const html = dentonDocument(raw);
  dentonTerminal(html);
  const inventory = dentonRegion(html, (tag) =>
    arrivals
      ? dentonClass(tag, "card-deck")
      : dentonAttribute(tag, "id") === "iiscont",
  );
  if (
    dentonElements(html, "div", (tag) => dentonClass(tag, "card-price"))
      .length !==
    dentonElements(inventory, "div", (tag) => dentonClass(tag, "card-price"))
      .length
  )
    throw new Error(
      "Native donor cards exist outside the selected inventory region",
    );
  return inventory;
}
function directory(raw: string, parent?: DentonControl) {
  return dentonBoundary("native directory", () => {
    const html = region(raw);
    const menu = dentonRegion(html, (tag) =>
      parent
        ? dentonAttribute(tag, "id") === "menumodellist"
        : dentonClass(tag, "iisMakesMenu"),
    );
    const controls = dentonElements(menu, "a").map((link): DentonControl => {
      const badges = dentonElements(link.body, "span", (tag) =>
        dentonClass(tag, "badge"),
      );
      const badge = dentonText(badges[0]?.body ?? "");
      const label = dentonText(
        link.body.replace(
          /(<span\b[^>]*>)[\s\S]*?<\/span>/gi,
          (literal: string, tag: string) =>
            dentonClass(tag, "badge") ? "" : literal,
        ),
      );
      const url = dentonOwnedUrl(dentonAttribute(link.tag, "href") ?? "");
      if (
        !url ||
        !/^\/used-parts\/[^/]+(?:\/[^/]+)?\/?$/.test(url.pathname) ||
        url.pathname.split("/").filter(Boolean).length !== (parent ? 3 : 2) ||
        (parent &&
          !url.pathname.startsWith(
            new URL(parent.url).pathname.replace(/\/$/, "") + "/",
          )) ||
        badges.length !== 1 ||
        !/^\d+$/.test(badge) ||
        !label
      )
        throw new Error(
          "A published menu control has an invalid destination, parent, label or count",
        );
      return { url: url.href, label, count: Number(badge) };
    });
    if (
      !controls.length ||
      controls.length > 1024 ||
      new Set(controls.map((c) => c.url)).size !== controls.length
    )
      throw new Error(
        "Native directory is empty, oversized or duplicates a destination",
      );
    return controls;
  });
}
function page(raw: string, context: DentonContext) {
  return dentonBoundary("native donor page", (): DentonPage => {
    const html = region(raw, context.kind === "arrivals");
    const cards = dentonElements(html, "div", (tag) =>
      dentonClass(tag, "card-price"),
    );
    const nativeEmpty =
      /No Results Found\. Try Browsing Our Parts Or Search Again/i.test(
        dentonText(html),
      );
    if (
      cards.length >= 500 ||
      (!cards.length && !nativeEmpty) ||
      (cards.length > 0 && nativeEmpty) ||
      dentonElements(html, "div", (tag) => dentonClass(tag, "car-details"))
        .length !== cards.length
    )
      throw new Error(
        "Native cards are missing, unaccounted, contradictory or reach the 500-card boundary",
      );
    const records = cards.map(({ body }, ordinal): DentonRecord => {
      const details = dentonRegion(body, (tag) =>
        dentonClass(tag, "car-details"),
      );
      const fields = [
        ...details.matchAll(
          /<b\b[^>]*>([\s\S]*?)<\/b\s*>([\s\S]*?)<br\s*\/?\s*>/gi,
        ),
      ].map((m) => ({
        label: dentonText(m[1] ?? "")
          .replace(/\s*:\s*$/, "")
          .toLowerCase(),
        value: dentonText(m[2] ?? ""),
      }));
      const labels = dentonElements(details, "b");
      if (labels.length !== fields.length)
        throw new Error("Native donor field is structurally incomplete");
      return {
        context,
        ordinal,
        fields,
        destinations: dentonElements(body, "a")
          .filter((link) => dentonText(link.body) === "See Parts")
          .map((link) => dentonAttribute(link.tag, "href")),
        images: [...body.matchAll(/<img\b[^>]*>/gi)].map(([tag]) =>
          dentonAttribute(tag, "data-src"),
        ),
      };
    });
    return { records, nativeEmpty };
  });
}

/** Literal catalog membership, without treating informational badges as row totals. */
export const DentonCatalog = {
  directory,
  model(raw: string, context: { make: DentonControl; model: DentonControl }) {
    return page(raw, { kind: "model", ...context });
  },
  arrivals(raw: string, makes: readonly DentonControl[]) {
    return page(raw, { kind: "arrivals", makes });
  },
} as const;
