import type { Yard } from "~/lib/yard";
import { CHESTERFIELD_ORIGIN } from "./chesterfield-client";
import type { ChesterfieldYardName } from "./chesterfield-donor";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

// Official form-footer addresses and business pins, verified 2026-11-11.
// The native yard label is the source location identifier, not a guessed ID.
export const CHESTERFIELD_YARDS = {
  Richmond: {
    source: "chesterfield",
    code: "Richmond",
    name: "Chesterfield Auto Parts Richmond",
    operator: "Chesterfield Auto Parts",
    address: "5111 Old Midlothian Tpke",
    city: "Richmond",
    state: "VA",
    postalCode: "23224",
    phone: "+18042335481",
    email: null,
    websiteUrl: CHESTERFIELD_ORIGIN,
    lat: 37.5070309,
    lng: -77.4922793,
  },
  "Fort Lee": {
    source: "chesterfield",
    code: "Fort Lee",
    name: "Chesterfield Auto Parts Fort Lee",
    operator: "Chesterfield Auto Parts",
    address: "4855 Puddledock Rd",
    city: "Prince George",
    state: "VA",
    postalCode: "23875",
    phone: "+18047329253",
    email: null,
    websiteUrl: CHESTERFIELD_ORIGIN,
    lat: 37.2468736,
    lng: -77.3669944,
  },
  Southside: {
    source: "chesterfield",
    code: "Southside",
    name: "Chesterfield Auto Parts Southside",
    operator: "Chesterfield Auto Parts",
    address: "12910 Genito Rd",
    city: "Midlothian",
    state: "VA",
    postalCode: "23112",
    phone: "+18047440716",
    email: null,
    websiteUrl: CHESTERFIELD_ORIGIN,
    lat: 37.4510689,
    lng: -77.6318571,
  },
} as const satisfies Record<ChesterfieldYardName, Yard>;

// Makes that /newest-cars lists but the native search form does not offer, so
// no make/model query can return their donors. Verified 2026-11-19: the form
// had 73 makes and no AMC, while /newest-cars listed a 1963 AMC RAMBLER
// (Richmond 000000086897). Add a make only after checking the live form.
export const CHESTERFIELD_UNSEARCHABLE_MAKES: ReadonlySet<string> = new Set([
  "AMC",
]);

export function parseChesterfieldYards(raw: string): Yard[] {
  if (!/<\/html>\s*$/i.test(raw))
    throw new Error("Truncated Chesterfield yard metadata");
  const html = stripInventoryRawText(raw);
  const addresses = [
    ...html.matchAll(/<address\b[^>]*>([\s\S]*?)<\/address\s*>/gi),
  ].map((m) => m[1] ?? "");
  const yards = Object.values(CHESTERFIELD_YARDS);
  if (addresses.length !== yards.length)
    throw new Error("Chesterfield yard metadata count changed");
  for (const yard of yards) {
    const matching = addresses.filter((address) =>
      address
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .includes(`${yard.address}, ${yard.city}, VA ${yard.postalCode}`),
    );
    const address = matching[0];
    const links = address
      ? [...address.matchAll(/<a\b([^>]*)>/gi)].map((m) =>
          inventoryHtmlAttribute(m[1] ?? "", "href"),
        )
      : [];
    const maps = links.flatMap((href) => {
      const url = href ? URL.parse(href) : null;
      return url?.origin === "https://www.google.com" &&
        url.pathname.startsWith("/maps/place/") &&
        !url.username &&
        !url.password
        ? [url]
        : [];
    });
    const pins = [
      ...(maps[0]?.pathname ?? "").matchAll(/!3d(-?[\d.]+)!4d(-?[\d.]+)/g),
    ];
    const pin = pins.at(-1); // Fort Lee publishes an address pin before its business pin.
    if (
      matching.length !== 1 ||
      maps.length !== 1 ||
      Number(pin?.[1]) !== yard.lat ||
      Number(pin?.[2]) !== yard.lng ||
      !links.some((href) => href?.replace(/-/g, "") === "tel:" + yard.phone)
    )
      throw new Error(
        "Chesterfield yard metadata changed or is ambiguous for " + yard.code,
      );
  }
  return yards;
}
