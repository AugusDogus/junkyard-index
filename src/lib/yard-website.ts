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
  ["rtp", "https://upullandsave.com/"],
  ["nvpap", "https://nvpap.com/"],
  ["pontiac", "https://u-pullandsave.com/"],
  ["aero", "https://aeroautosalvage.com/"],
  ["chesterfield", "https://chesterfieldauto.com/"],
  ["midway", "https://midwayupull.com/"],
  ["fenix", "https://fenixupull.com/"],
  ["importapart", "https://importapart.com/blogs/part-outs"],
  ["bigtruckpage", "https://bigtruckpage.com/"],
  ["denton", "https://dentonauto.com/"],
  ["beavers", "https://www.beaverscarsalvage.com/"],
  ["indianriver", "https://indianriverautosalvage.com/"],
  ["oem", "https://oemautorecyclers.com/"],
  ["dutchers", "https://dutchersinc.com/"],
  ["chasencars", "https://chasencarsauto.com/"],
  ["oemgarage", "https://oe-mgarage.com/"],
  ["hagerman", "https://hagermanparts.com/"],
  ["kandr", "https://kandrtruckparts.com/"],
  ["jimsimport", "https://jimsimport.com/"],
  ["army", "https://armysauto.com/self-service-inventory/"],
  ["idipull", "https://ifipull.com/inventory/"],
  ["pullsavewa", "http://www.pullandsave.com/home.htm"],
  ["littleton", "https://littletonupullit.com/vehicle-inventory"],
  ["michigantruck", "https://michigantruck.com/trucks/"],
  ["joliet", "https://www.jolietupullit.com/inventory"],
  ["alln1", "https://alln1kc.com/"],
  ["pickers", "https://pickerstxk.com/"],
  ["pipes", "https://www.pipesupullit.net/"],
  ["millerstown", "http://picapartyard.com/"],
  ["pickapartva", "https://pickapartva.com/"],
  ["mccauley", "https://www.mccauleysauto.com/parts-vehicles"],
  ["aviation", "https://aviationauto.com/"],
  ["chaz", "https://www.chazsauto.com/"],
  ["citymotors", "https://citymotorsparts.com/"],
  ["awap", "https://www.alwholesaleautoparts.com/"],
  ["clearsalvage", "https://clearsalvage.com/vehicle-inventory/"],
  ["aplus", "https://aplusauto.parts/"],
  ["central", "https://centralautoliq.com/"],
  ["coutu", "https://www.truckcountry.us/"],
  ["kodak", "https://kodakauto.co/"],
  ["rohner", "https://rohnersautoparts.com/"],
  ["cars4parts", "https://cars4parts.carzrus1.com/"],
  ["meeks", "https://meeksrecycling.com/"],
  ["brandywine", "https://www.brandywineupullit.com/"],
  ["rightway", "https://rightwayautorecycling.com/"],
  ["ddauto", "https://www.ddautoandsalvage.com/self-service-parts-yard"],
  [
    "rivervalley",
    "https://rivervalleytruckparts.com/new-arrivals/?f-condition=nw",
  ],
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
