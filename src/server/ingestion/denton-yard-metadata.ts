import type { Yard } from "~/lib/yard";

/** Native contact page and its named map embed, captured 2026-11-15.
 * The about page explicitly places all Denton/Autoland inventory here. */
export const DENTON_YARD = {
  source: "denton",
  code: "KS12",
  name: "Denton Auto Parts",
  operator: "Denton Auto Salvage",
  address: "14580 South Topeka Ave",
  city: "Carbondale",
  state: "KS",
  postalCode: "66414",
  phone: "785-437-2223",
  email: "parts@dentonauto.com",
  lat: 38.80331100000001,
  lng: -95.686134,
  websiteUrl: "https://dentonauto.com/",
} satisfies Omit<Yard, "source"> & { source: "denton" };

export const DENTON_MAKES = "https://dentonauto.com/used-parts/makes/";
export const DENTON_ARRIVALS = "https://dentonauto.com/iislatestarrivals/";

/** The original stock control redirected here and returned 503 on 2026-11-11.
 * Keep this donor quarantined until the failure has explicit resolution evidence.
 * This does not add a requirement to fetch every donor detail. */
export const DENTON_PRESERVED_DESTINATION_FAILURES = [
  {
    url: "https://dentonauto.com/used-parts/HYUNDAI/SANTA_FE/AD80068/2019",
    status: 503,
    evidence:
      ".scratchpad/coverage/new-leads/seventh-wave/denton-stock-control.json",
  },
] as const;
