import { createHash } from "node:crypto";
import { stripInventoryRawText } from "./inventory-html";
import {
  iisAttribute as attr,
  iisClass as cls,
  iisElements as elements,
  iisRegion as region,
  iisText as text,
  iisContinuation,
} from "./iis-html";

import {
  UrgiisControlSchema,
  type UrgiisControl,
  type UrgiisRecord,
  type UrgiisSite,
} from "./urgiis-schema";
export type { UrgiisControl, UrgiisRecord, UrgiisSite } from "./urgiis-schema";
export const iisHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function iisOwnedUrl(raw: string, site: UrgiisSite) {
  const url = URL.parse(raw, site.origin);
  return url &&
    url.origin === site.origin &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    !raw.includes("\\")
    ? url
    : null;
}
export function iisBrowsePath(raw: string, depth: number, site: UrgiisSite) {
  const url = iisOwnedUrl(raw, site);
  const parts = url?.pathname.split("/").filter(Boolean);
  return url && parts?.length === depth + 1 && parts[0] === site.pathStyle
    ? url.pathname
    : null;
}
export function iisDocument(raw: string, site: UrgiisSite) {
  const html = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > 4 * 1024 * 1024 ||
    [/<html\b/gi, /<body\b/gi, /<\/body\s*>/gi, /<\/html\s*>/gi].some(
      (p) => [...html.matchAll(p)].length !== 1,
    ) ||
    !/<\/body\s*>\s*<\/html\s*>\s*$/i.test(html)
  )
    throw new Error("IIS document is oversized or truncated");
  const ids = [...raw.matchAll(/\bvar\s+urgid\s*=\s*(['"])(.*?)\1\s*;/g)].map(
    (m) => m[2],
  );
  // Lake Point moves its native UU23 declaration into LiteSpeed bundles.
  // Saved scripts verify these exact content hashes; changed assets fail closed.
  const supplierBundles =
    site.origin === "https://lakepointauto.com" && site.urgid === "UU23"
      ? [...raw.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<script\b[^>]*>/gi)]
          .map(([tag]) => tag)
          .filter((tag) => attr(tag, "data-optimized") === "1")
      : [];
  const knownSupplierBundle =
    supplierBundles.length === 1 &&
    [
      "08d3082e19c81dd9e309ebfe58cdd809",
      "e3896d4a1fec6b4d6c9c19f078417b3a",
      "39db489fc853da352aa4cff83df01e73",
      "5fd169a3e874d9270f77caaaa63466a0",
      "19fbb292174b9c76ca14c2e68fe9b3af",
      "109475697a861a25286362dda4420580",
      "2c733cc353e1f69c742a7aee3ce9bb31",
    ].some(
      (hash) =>
        supplierBundles[0] ===
        '<script data-optimized="1" type="litespeed/javascript" data-src="https://lakepointauto.com/wp-content/litespeed/js/' +
          hash +
          '.js?ver=9a323">',
    );
  if (
    (!ids.length && !knownSupplierBundle) ||
    ids.some((id) => id !== site.urgid)
  )
    throw new Error("IIS supplier identity changed: expected " + site.urgid);
  return html;
}
const inventory = (raw: string, site: UrgiisSite) =>
  region(iisDocument(raw, site), (t) => attr(t, "id") === "iiscont");
function terminal(html: string) {
  const bounded = html.replace(
    /<button\b[^>]*class=["'][^"']*aps-gallery-carousel-control[^"']*["'][^>]*>[\s\S]*?<\/button\s*>/gi,
    (literal: string) => {
      const tag = literal.slice(0, literal.indexOf(">") + 1);
      return ["#apsPartsGalleryCarousel", "#apsLaGalleryCarousel"].includes(
        attr(tag, "data-bs-target") ?? "",
      ) &&
        ["next", "prev"].includes(attr(tag, "data-bs-slide") ?? "") &&
        [
          "href",
          "rel",
          "data-next-page",
          "data-next-url",
          "data-next-cursor",
        ].every((key) => attr(tag, key) === null)
        ? ""
        : literal;
    },
  );
  if (iisContinuation(bounded).length)
    throw new Error(
      "IIS has unread continuation controls; preserve prior inventory",
    );
}
export function iisDirectory(
  raw: string,
  site: UrgiisSite,
  parent?: UrgiisControl,
): UrgiisControl[] {
  const html = inventory(raw, site);
  terminal(html);
  const menu = region(html, (t) =>
    parent ? attr(t, "id") === "menumodellist" : cls(t, "iisMakesMenu"),
  );
  const controls = elements(menu, "a").map((a) => {
    const badges = elements(
      a.body,
      "span",
      (t) => cls(t, "badge") || cls(t, "aps-make-link__count"),
    );
    const badge = badges[0];
    const count = text(badge?.body ?? "");
    const labels = elements(a.body, "span", (t) =>
      cls(t, "aps-make-link__label"),
    );
    const cleanLabel = labels.length
      ? text(labels[0]?.body ?? "")
      : text(
          a.body.replace(
            /(<span\b[^>]*>)[\s\S]*?<\/span\s*>/gi,
            (literal: string, tag: string) =>
              cls(tag, "badge") || cls(tag, "aps-make-link__count")
                ? ""
                : literal,
          ),
        );
    const path = iisBrowsePath(attr(a.tag, "href") ?? "", parent ? 2 : 1, site);
    if (
      !path ||
      !cleanLabel ||
      badges.length !== 1 ||
      !/^\d+$/.test(count) ||
      (parent && !path.startsWith(parent.path.replace(/\/$/, "") + "/"))
    )
      throw new Error(
        "IIS published directory control has invalid destination, parent, label or count",
      );
    return UrgiisControlSchema.parse({
      path,
      label: cleanLabel,
      count: Number(count),
    });
  });
  if (
    !controls.length ||
    controls.length > 1024 ||
    new Set(controls.map((c) => c.path)).size !== controls.length
  )
    throw new Error(
      "IIS directory is empty, oversized or repeats a destination",
    );
  return controls;
}
export function iisCards(
  raw: string,
  site: UrgiisSite,
  surface: "model" | "arrivals" = "model",
) {
  const html =
    surface === "model" ? inventory(raw, site) : iisDocument(raw, site);
  if (surface === "arrivals") {
    const titles = elements(html, "title");
    const title = text(titles[0]?.body ?? "");
    const knownVariant = [
      "New Arrivals, Recycled Vehicles - Higgins Auto Parts",
      "Latest Used Auto Parts Arrivals",
      "Latest Used Auto Parts Arrivals | A-Z Auto Parts",
    ].includes(title);
    if (
      titles.length !== 1 ||
      (!knownVariant &&
        !/\b(?:recent|latest)(?: vehicle)? arrivals\b/i.test(title))
    )
      throw new Error("IIS native arrivals title is missing or changed");
  }
  terminal(html);
  const premium = elements(html, "div", (t) => cls(t, "aps-la-card-premium"));
  const blocks = premium.length
    ? premium
    : elements(html, "div", (t) => cls(t, "card-price"));
  const empty =
    /No Results(?: Found)?[.\s]*Try Browsing Our Parts Or Search Again/i.test(
      text(html),
    );
  if ((!blocks.length && !empty) || (blocks.length && empty))
    throw new Error(
      "IIS donor cards missing or contradict explicit empty result",
    );
  const detailsCount = elements(html, "div", (t) =>
    cls(t, premium.length ? "aps-la-car-details" : "car-details"),
  ).length;
  if (detailsCount !== blocks.length)
    throw new Error("IIS identity regions exist outside accounted donor cards");
  const records = blocks.map(({ body }): UrgiisRecord => {
    const details = region(body, (t) =>
      cls(t, premium.length ? "aps-la-car-details" : "car-details"),
    );
    const fields = new Map<string, string[]>();
    const add = (label: string, value: string) => {
      const key = text(label)
        .replace(/\s*:\s*$/, "")
        .toLowerCase();
      fields.set(key, [...(fields.get(key) ?? []), text(value)]);
    };
    for (const m of details.matchAll(
      /<(?:b|strong)\b[^>]*>([\s\S]*?)<\/(?:b|strong)\s*>([\s\S]*?)<br\s*\/?\s*>/gi,
    ))
      add(m[1] ?? "", m[2] ?? "");
    if (premium.length) {
      for (const stat of elements(details, "div", (t) =>
        cls(t, "aps-la-stat-premium"),
      ))
        add(
          elements(stat.body, "div", (t) => cls(t, "aps-la-stat-label"))[0]
            ?.body ?? "",
          elements(stat.body, "div", (t) => cls(t, "aps-la-stat-value"))[0]
            ?.body ?? "",
        );
      for (const y of elements(details, "div", (t) =>
        cls(t, "aps-la-right-val-premium"),
      ))
        if (text(y.body).startsWith("Year"))
          add("year", text(y.body).replace(/^Year\s*/, ""));
      for (const title of elements(details, "h3", (t) =>
        cls(t, "aps-la-title-premium"),
      ))
        add("make/model", title.body);
      for (const vin of elements(details, "p", (t) =>
        cls(t, "aps-la-subtitle-premium--vin"),
      ))
        add("vin", text(vin.body).replace(/^VIN\s*:\s*/i, ""));
    }
    // Some older IIS templates print Vin : outside bold labels.
    if (!fields.has("vin")) {
      const match = text(details).match(/\bVin\s*:\s*([^ ]*)/i);
      if (match) add("vin", match[1] ?? "");
    }
    const optional = (label: string) => {
      const vs = [...new Set(fields.get(label) ?? [])].filter(Boolean);
      return vs.length === 1 ? (vs[0] ?? null) : null;
    };
    const destinations = elements(body, "a")
      .filter(
        (a) =>
          /^See Parts\b/i.test(text(a.body)) ||
          cls(a.tag, "aps-la-card-link-premium") ||
          cls(a.tag, "aps-la-parts-btn"),
      )
      .map(
        (a) => URL.parse(attr(a.tag, "href") ?? "", site.origin)?.href ?? "",
      );
    const inquiries = [...body.matchAll(/<[^/!][^>]*>/g)].flatMap(([t]) => {
      const v = attr(t, "data-vehicle");
      return v === null ? [] : [v];
    });
    const imageBody =
      elements(body, "div", (t) => cls(t, "card-img"))[0]?.body ?? body;
    const tag = [...imageBody.matchAll(/<img\b[^>]*>/gi)][0]?.[0];
    return {
      years: fields.get("year") ?? [],
      titles: fields.get("make/model") ?? [],
      vins: fields.get("vin") ?? [],
      inquiries,
      destinations,
      stock: optional("stock") ?? optional("stock #"),
      image: tag ? optionalImage(tag) : null,
      date: optional("enter date"),
    };
  });
  return {
    records,
    nativeEmpty: empty,
    hash: iisHash(records),
    capped: blocks.length >= 500,
  };
}

// Tiny badges can include stale part-bin entries. Three advertised donors with
// no cards is incomplete evidence, even far below the native 500-card boundary.
export function iisValidateModelPage(
  page: ReturnType<typeof iisCards>,
  model: UrgiisControl,
) {
  if (page.capped)
    throw new Error("IIS native 500-card boundary reached at " + model.path);
  if (page.nativeEmpty && model.count >= 3)
    throw new Error(
      `IIS model ${model.path} advertises ${model.count} donors but returns an explicit empty result; enumeration is incomplete`,
    );
}

function optionalImage(tag: string): string | null {
  try {
    return attr(tag, "data-src") ?? attr(tag, "src");
  } catch {
    return null;
  }
}
