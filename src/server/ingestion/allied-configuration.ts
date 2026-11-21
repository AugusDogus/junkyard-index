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

/**
 * Model routes that list no donors on this host under any spelling probed on
 * November 20, 2026, so their badged explicit empties count against the 1%
 * allowance instead of failing the census:
 * - NEW_YORKER_(FWD): the literal route is refused with HTTP 403 and the
 *   percent-encoded one returns an explicit empty.
 * - PLYMOUTH_PASS. and SUBARU_PASS.: the menus label them "PASS/". The
 *   literal, %2E and %2F spellings all return an explicit empty.
 */
export const ALLIED_UNREACHABLE_MODEL_ROUTES: ReadonlySet<string> = new Set([
  "/parts/CHRYSLER/NEW_YORKER_(FWD)/",
  "/parts/PLYMOUTH/PLYMOUTH_PASS./",
  "/parts/SUBARU/SUBARU_PASS./",
]);
/**
 * Routes sent with literal parentheses. Every other route keeps the
 * percent-encoded spelling the November 15 census was captured with. On
 * November 20, 2026 the literal ISUZU_PUP_(PICKUP) and SAFARI_(GMC) routes
 * listed their cards while their %28/%29 spellings returned explicit empties,
 * and the literal NEW_YORKER_(FWD) route was refused with HTTP 403. On
 * November 21 the literal BLAZER.JIMMY_(FULL_SIZE) and SPRINT_(CHEV) routes
 * listed 4 and 1 donors while their %28/%29 spellings returned explicit
 * empties. Change a route's spelling only after probing both spellings on
 * this host.
 */
export const ALLIED_LITERAL_PARENTHESIS_ROUTES: ReadonlySet<string> = new Set([
  "/parts/CHEVROLET/BLAZER.JIMMY_(FULL_SIZE)/",
  "/parts/CHEVROLET/SPRINT_(CHEV)/",
  "/parts/GMC/SAFARI_(GMC)/",
  "/parts/ISUZU/ISUZU_PUP_(PICKUP)/",
]);
