import type { AlliedContract } from "./allied-contract";
import { ALLIED_ORIGIN } from "./allied-html";

export const ALLIED_YARD = {
  source: "allied",
  code: "weare",
  name: "Allied Auto Wrecking",
  operator: "Allied Auto Wrecking",
  address: "32 Dustin Tavern Rd",
  city: "Weare",
  state: "NH",
  postalCode: "03281",
  phone: "603-529-7211",
  email: null,
  // US Census Public_AR_Current, exact published street/city/state/ZIP match.
  lat: 43.027831788738,
  lng: -71.693656846442,
  websiteUrl: ALLIED_ORIGIN + "/",
} as const satisfies AlliedContract["yard"];
export const ALLIED_CONTRACT = {
  yard: ALLIED_YARD,
  minimumUniqueInventory: 835,
} satisfies AlliedContract;
