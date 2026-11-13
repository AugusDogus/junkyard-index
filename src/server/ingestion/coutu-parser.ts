import { createHash } from "node:crypto";
import { z } from "zod";
import { inventoryHtmlAttribute } from "./inventory-html";
import {
  coutuDocument,
  coutuElements,
  coutuRegion,
  coutuText,
} from "./coutu-html";
import { coutuBrowsePath, coutuDonorUrl, coutuImage } from "./coutu-protocol";

export const coutuHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const CoutuControlSchema = z
  .object({
    path: z.string().min(1).max(300),
    label: z.string().min(1).max(100),
  })
  .strict();
export type CoutuControl = z.infer<typeof CoutuControlSchema>;
// All independent required claims survive checkpointing, including conflicts.
export const CoutuRecordSchema = z.tuple([
  z.string().max(100), // VIN
  z.string().max(30), // year chip
  z.string().max(30), // header year
  z.string().max(100), // header make
  z.string().max(200), // header model
  z.string().max(100), // breadcrumb make
  z.string().max(200), // breadcrumb model
  z.string().max(100), // optional stock
  z.string().max(1000), // literal donor destination
  z.string().max(1500).nullable(), // optional photo
]);
export type CoutuRecord = z.infer<typeof CoutuRecordSchema>;
export const CoutuPageSchema = z
  .object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    records: z.array(CoutuRecordSchema).max(1000),
  })
  .strict();
export type CoutuPage = z.infer<typeof CoutuPageSchema>;

function terminal(main: string) {
  for (const match of main.matchAll(
    /(<(?:a|button)\b[^>]*>)([\s\S]*?)<\/(?:a|button)>/gi,
  )) {
    const tag = match[1] ?? "";
    const label = coutuText(match[2] ?? "");
    const href = inventoryHtmlAttribute(tag, "href") ?? "";
    const relation = (inventoryHtmlAttribute(tag, "rel") ?? "").split(/\s+/);
    const accessibleLabel = coutuText(
      inventoryHtmlAttribute(tag, "aria-label") ?? "",
    );
    if (
      /paginat|page-link|load.?more/i.test(
        inventoryHtmlAttribute(tag, "class") ?? "",
      ) ||
      relation.some((token) => /^(?:next|prev)$/i.test(token)) ||
      /^(?:go to )?(?:next|prev(?:ious)?)(?: page)?$/i.test(accessibleLabel) ||
      /^(?:next(?: page)?|previous(?: page)?|load more|show more|\d+)$/i.test(
        label,
      ) ||
      /[?&](?:page|offset|cursor)=/i.test(href)
    )
      throw new Error(
        "Coutu native continuation changed; inspect the complete published browse graph",
      );
  }
  for (const tag of main.matchAll(/<(?:nav|ul|ol)\b[^>]*>/gi))
    if (
      /paginat/i.test(
        (inventoryHtmlAttribute(tag[0], "class") ?? "") +
          " " +
          (inventoryHtmlAttribute(tag[0], "aria-label") ?? ""),
      )
    )
      throw new Error("Coutu numeric pagination changed");
}

function mainDocument(raw: string) {
  const main = coutuRegion(coutuDocument(raw), "main");
  terminal(main);
  return main;
}

function breadcrumbs(main: string) {
  const nav = coutuRegion(main, "nav");
  return coutuElements(nav, "a").map((a) => ({
    path: inventoryHtmlAttribute(a.tag, "href") ?? "",
    label: coutuText(a.body),
  }));
}

export function parseCoutuHome(raw: string): string {
  const main = coutuRegion(coutuDocument(raw), "main");
  const about = coutuText(coutuRegion(main, "section", "about"));
  if (
    !about.includes("About Our Work Truck Parts Yard") ||
    !about.includes("our Willimantic, Connecticut warehouse")
  )
    throw new Error("Coutu native own-yard donor source contract changed");
  return coutuHash([
    "Truck Country",
    "1535 W Main St",
    "Willimantic, CT 06226",
    "860-423-6004",
    "About Our Work Truck Parts Yard",
  ]);
}

export function parseCoutuDirectory(
  raw: string,
  kind: "makes" | "models",
  parent?: CoutuControl,
): CoutuControl[] {
  const main = mainDocument(raw);
  const heading = coutuText(coutuRegion(main, "h1"));
  const crumbs = breadcrumbs(main);
  if (
    heading !==
      (kind === "makes"
        ? "Select Your Vehicle Make"
        : "Select Model for " + parent?.label) ||
    (kind === "models" && crumbs.at(-1)?.path !== parent?.path)
  )
    throw new Error("Coutu directory heading or native make binding changed");
  const region = coutuRegion(main, "div", "view-categories");
  const controls = coutuElements(region, "a").map((anchor) => {
    const path = coutuBrowsePath(
      coutuText(inventoryHtmlAttribute(anchor.tag, "href") ?? ""),
      kind === "makes" ? 1 : 2,
    );
    if (!path || (parent && !path.startsWith(parent.path + "/")))
      throw new Error(
        "Coutu published directory destination or parent changed",
      );
    // Native badges count parts, not donors. Their changing values never supply a donor denominator.
    return CoutuControlSchema.parse({
      path,
      label: coutuText(coutuRegion(anchor.body, "h3")),
    });
  });
  if (
    !controls.length ||
    controls.length > (kind === "makes" ? 64 : 128) ||
    new Set(controls.map((c) => c.path)).size !== controls.length
  )
    throw new Error(
      "Coutu directory is empty, oversized or repeats a destination",
    );
  return controls;
}

export function parseCoutuModel(
  raw: string,
  make: CoutuControl,
  model: CoutuControl,
  nativeMakes: readonly string[],
): CoutuPage {
  const main = mainDocument(raw);
  const crumbs = breadcrumbs(main);
  if (
    !model.path.startsWith(make.path + "/") ||
    crumbs.length !== 4 ||
    crumbs[2]?.path !== make.path ||
    crumbs[2]?.label !== make.label ||
    crumbs[3]?.path !== model.path ||
    crumbs[3]?.label !== model.label ||
    coutuText(coutuRegion(main, "h1")) !== `Browse ${make.label} ${model.label}`
  )
    throw new Error(
      "Coutu returned model belongs to another published native control",
    );
  const countText = coutuText(coutuRegion(main, "button", "tab-vehicles"));
  const count = /^Browse by Vehicles \((\d+)\)$/.exec(countText)?.[1];
  if (count === undefined)
    throw new Error("Coutu native vehicle-tab denominator is missing");
  const region = coutuRegion(main, "div", "view-vehicles");
  const grid = coutuRegion(region, "div");
  const cards = coutuElements(grid, "div");
  if (cards.length !== Number(count) || cards.length > 1000)
    throw new Error(
      "Coutu vehicle-tab count does not match all rendered donor cards",
    );
  const names = [...nativeMakes].sort((a, b) => b.length - a.length);
  const records = cards.map((card) => {
    const spans = coutuElements(card.body, "span").map((s) =>
      coutuText(s.body),
    );
    const headers = coutuElements(card.body, "h3");
    const chipSpans = coutuElements(
      card.body.split(/<h3\b/i)[0] ?? "",
      "span",
    ).map((s) => coutuText(s.body));
    // The native year chip is the final span before the donor heading. Earlier
    // stock markup is optional and must not gate a complete required identity.
    const year = chipSpans.at(-1) ?? "";
    const stocks = chipSpans
      .slice(0, -1)
      .filter((text) => /^Stock #/i.test(text))
      .map((text) => text.replace(/^Stock #/i, ""));
    const vinLabels = spans.flatMap((text, index) =>
      text === "VIN" ? [index] : [],
    );
    const vinIndex = vinLabels[0];
    if (
      headers.length !== 1 ||
      vinLabels.length !== 1 ||
      vinIndex === undefined
    )
      throw new Error("Coutu donor labelled identity region changed");
    const header = /^(\d{4}) (.+)$/.exec(coutuText(headers[0]?.body ?? ""));
    const title = header?.[2] ?? "";
    const headerMake = names.find((name) => title.startsWith(name + " ")) ?? "";
    const links = coutuElements(card.body, "a").filter(
      (a) => coutuText(a.body) === "See Parts",
    );
    if (links.length !== 1)
      throw new Error("Coutu donor lacks one literal See Parts destination");
    const href = coutuText(
      inventoryHtmlAttribute(links[0]?.tag ?? "", "href") ?? "",
    );
    const image = [...card.body.matchAll(/<img\b[^>]*>/gi)][0]?.[0];
    return CoutuRecordSchema.parse([
      spans[vinIndex + 1] ?? "",
      year,
      header?.[1] ?? "",
      headerMake,
      headerMake ? title.slice(headerMake.length).trim() : "",
      make.label,
      model.label,
      stocks.length === 1 && (stocks[0]?.length ?? 0) <= 100 ? stocks[0] : "",
      coutuDonorUrl(href) ?? href,
      coutuImage(
        image ? coutuText(inventoryHtmlAttribute(image, "src") ?? "") : null,
      ),
    ]);
  });
  return { records, hash: coutuHash(records) };
}
