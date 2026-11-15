import type { Yard } from "~/lib/yard";
export const VINPLUS_API =
  "https://inventory-search-api-581547763015.us-central1.run.app";
type VinplusYard = Yard & {
  source: "vinplus";
  lat: number;
  lng: number;
  websiteUrl: string;
};
export interface VinplusTenant {
  yardId: string;
  slug: string;
  label: string;
  timezone: string;
  hiddenSearch: boolean;
  inventory:
    | { kind: "crush"; stockDigits: 5 | 6 }
    | { kind: "yardsmart"; yardLocation: string };
  minimum: number;
  yard: VinplusYard;
}
const yard = (
  location: Omit<
    VinplusYard,
    "source" | "operator" | "websiteUrl" | "phone" | "email"
  >,
  slug: string,
): VinplusYard => ({
  ...location,
  source: "vinplus",
  operator: location.name,
  websiteUrl: `https://vinplus.texnrewards.com/parts/${slug}`,
  phone: null,
  email: null,
});
// Census Public_AR_Current street-range interpolations of the published addresses.
// Original requests and matches are frozen in qualification.json.gz.
export const VINPLUS_TENANTS: readonly VinplusTenant[] = [
  {
    yardId: "u_pull_auto_parts_pocatello",
    slug: "u-pull-auto-parts-pocatello",
    label: "U Pull Auto Parts Pocatello",
    timezone: "America/Denver",
    hiddenSearch: true,
    inventory: { kind: "crush", stockDigits: 6 },
    minimum: 600,
    yard: yard(
      {
        code: "pocatello",
        name: "U Pull Auto Parts Pocatello",
        address: "9587 N Philbin Rd",
        city: "Pocatello",
        state: "ID",
        postalCode: "83202",
        lat: 42.89946637254,
        lng: -112.495800567155,
      },
      "u-pull-auto-parts-pocatello",
    ),
  },
  {
    yardId: "ryan_s_pick_a_part",
    slug: "ryans",
    label: "Ryan's Pick-A-Part",
    timezone: "America/New_York",
    hiddenSearch: false,
    inventory: { kind: "crush", stockDigits: 6 },
    minimum: 1200,
    yard: yard(
      {
        code: "ryans",
        name: "Ryan's Pick-A-Part",
        address: "9309 Hubbell Street",
        city: "Detroit",
        state: "MI",
        postalCode: "48228",
        lat: 42.363251568324,
        lng: -83.187495433027,
      },
      "ryans",
    ),
  },
  {
    yardId: "us_auto_supply",
    slug: "us-auto-supply",
    label: "US Auto Supply",
    timezone: "America/New_York",
    hiddenSearch: false,
    inventory: { kind: "crush", stockDigits: 6 },
    minimum: 900,
    yard: yard(
      {
        code: "sterling-heights",
        name: "US Auto Supply of Sterling Heights",
        address: "7575 18 1/2 Mile Rd",
        city: "Sterling Heights",
        state: "MI",
        postalCode: "48314",
        lat: 42.601893504252,
        lng: -83.036124488316,
      },
      "us-auto-supply",
    ),
  },
  {
    yardId: "yourpart",
    slug: "yourpart",
    label: "YourPart",
    timezone: "America/New_York",
    hiddenSearch: false,
    inventory: { kind: "crush", stockDigits: 6 },
    minimum: 400,
    yard: yard(
      {
        code: "hinesville",
        name: "YourPart (SA Recycling)",
        address: "6880 US Highway 84",
        city: "Hinesville",
        state: "GA",
        postalCode: "31313",
        lat: 31.76777246428,
        lng: -81.643658295697,
      },
      "yourpart",
    ),
  },
  {
    yardId: "pick_ur_part",
    slug: "pick-ur-part",
    label: "Pick Ur Part",
    timezone: "America/Chicago",
    hiddenSearch: false,
    inventory: { kind: "yardsmart", yardLocation: "Lubbock" },
    minimum: 850,
    yard: yard(
      {
        code: "lubbock",
        name: "Pick Ur Part",
        address: "4125 E Slaton Rd",
        city: "Lubbock",
        state: "TX",
        postalCode: "79404",
        lat: 33.520132845259,
        lng: -101.780012462231,
      },
      "pick-ur-part",
    ),
  },
];
