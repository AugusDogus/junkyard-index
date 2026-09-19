import { normalizeRegion } from "~/server/ingestion/normalization";
import { Yard } from "./yard";

export type YardWebsite = { kind: "yard" | "provider"; href: string };

const providerWebsites = new Map<string, string>([
  ["pyp", "https://www.pyp.com/locations/"],
  ["pullapart", "https://www.pullapart.com/locations/"],
  ["gopullit", "https://gopullit.com/"],
  ["pullnsave", "https://www.pullnsave.com/"],
  ["tearapart", "https://tearapart.com/"],
  ["upullitne", "https://upullitne.com/"],
  ["upullrparts", "https://upullrparts.com/contact/"],
  ["wrenchapart", "https://wrenchapart.com/"],
  ["ipullupull", "https://ipullupull.com/locations/"],
  ["upullitwa", "https://go2upullit.com/"],
  ["partsgalore", "https://parts-galore.com/"],
  ["upullitdavie", "https://upullitdavie.com/"],
]);

export function pypYardWebsite(
  raw: string | null | undefined,
  code: string,
): string | null {
  const url = raw ? URL.parse(raw, "https://www.pyp.com") : null;
  if (
    !url ||
    ![
      "www.pyp.com",
      "pyp.com",
      "www.lkqpickyourpart.com",
      "lkqpickyourpart.com",
    ].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.protocol !== "https:"
  )
    return null;
  const inventory = /^\/inventory\/([a-z0-9-]+-(\d+))\//.exec(url.pathname);
  if (inventory?.[2] === code) url.pathname = `/inventory/${inventory[1]}/`;
  else if (
    !/^\/locations\/[a-z]{2}\/[a-z0-9-]+\/[a-z0-9-]+\/$/.test(url.pathname)
  )
    return null;
  url.hash = "";
  url.search = "";
  return Yard.website(url.href);
}

type WebsiteYard = {
  source: string;
  code: string;
  name: string;
  state: string;
  operator?: string | null;
  websiteUrl?: string | null;
  inventoryUrl?: string | null;
};

export function resolveYardWebsite(yard: WebsiteYard): YardWebsite | null {
  const stored =
    yard.source === "pyp"
      ? pypYardWebsite(yard.websiteUrl, yard.code)
      : Yard.website(yard.websiteUrl ?? null);
  if (stored)
    return {
      kind:
        stored === providerWebsites.get(yard.source) &&
        !["partsgalore", "upullitdavie"].includes(yard.source)
          ? "provider"
          : "yard",
      href: stored,
    };
  if (yard.source === "pyp") {
    const inventory = pypYardWebsite(yard.inventoryUrl, yard.code);
    if (inventory) return { kind: "yard", href: inventory };
  }
  if (yard.source === "pullapart") {
    const upp =
      yard.operator === "U-Pull-&-Pay" || /^U-Pull-&-Pay\s*-/i.test(yard.name);
    const pap =
      yard.operator === "Pull-A-Part" || /^Pull-A-Part\s*-/i.test(yard.name);
    const name = yard.name
      .replace(/^(?:Pull-A-Part|U-Pull-&-Pay)\s*-\s*/i, "")
      .toLowerCase()
      .replace(/\s+/g, "-");
    const region = normalizeRegion(yard.state);
    // The public location directory uses s-carolina, not south-carolina.
    const state =
      region.stateAbbr === "SC"
        ? "s-carolina"
        : region.state.toLowerCase().replace(/\s+/g, "-");
    if ((upp || pap) && region.stateAbbr && /^[a-z-]+$/.test(name))
      return {
        kind: "yard",
        href: `https://www.${upp ? "upullandpay" : "pullapart"}.com/locations/${state}/${name}/`,
      };
  }
  const provider = providerWebsites.get(yard.source);
  return provider ? { kind: "provider", href: provider } : null;
}
