import { Slug } from "./slug";

const REGION_NAMES = {
  US: {
    AL: "Alabama",
    AK: "Alaska",
    AZ: "Arizona",
    AR: "Arkansas",
    CA: "California",
    CO: "Colorado",
    CT: "Connecticut",
    DE: "Delaware",
    DC: "District of Columbia",
    FL: "Florida",
    GA: "Georgia",
    HI: "Hawaii",
    ID: "Idaho",
    IL: "Illinois",
    IN: "Indiana",
    IA: "Iowa",
    KS: "Kansas",
    KY: "Kentucky",
    LA: "Louisiana",
    ME: "Maine",
    MD: "Maryland",
    MA: "Massachusetts",
    MI: "Michigan",
    MN: "Minnesota",
    MS: "Mississippi",
    MO: "Missouri",
    MT: "Montana",
    NE: "Nebraska",
    NV: "Nevada",
    NH: "New Hampshire",
    NJ: "New Jersey",
    NM: "New Mexico",
    NY: "New York",
    NC: "North Carolina",
    ND: "North Dakota",
    OH: "Ohio",
    OK: "Oklahoma",
    OR: "Oregon",
    PA: "Pennsylvania",
    RI: "Rhode Island",
    SC: "South Carolina",
    SD: "South Dakota",
    TN: "Tennessee",
    TX: "Texas",
    UT: "Utah",
    VT: "Vermont",
    VA: "Virginia",
    WA: "Washington",
    WV: "West Virginia",
    WI: "Wisconsin",
    WY: "Wyoming",
  },
  CA: {
    AB: "Alberta",
    BC: "British Columbia",
    MB: "Manitoba",
    NB: "New Brunswick",
    NL: "Newfoundland and Labrador",
    NS: "Nova Scotia",
    ON: "Ontario",
    PE: "Prince Edward Island",
    QC: "Quebec",
    SK: "Saskatchewan",
  },
} as const;

type Country = keyof typeof REGION_NAMES;

/** A US state, DC, or Canadian province that yards are grouped under. */
export type Region = {
  abbr: string;
  name: string;
  slug: string;
  country: Country;
};

function regionsOf(country: Country): Region[] {
  return Object.entries(REGION_NAMES[country]).map(([abbr, name]) => ({
    abbr,
    name,
    slug: Slug.from(name),
    country,
  }));
}

const REGIONS: readonly Region[] = [...regionsOf("US"), ...regionsOf("CA")];

const BY_ABBR = new Map(REGIONS.map((region) => [region.abbr, region]));
const BY_SLUG = new Map(REGIONS.map((region) => [region.slug, region]));

export const Region = {
  /** The region for a two-letter postal abbreviation, in any case. */
  fromAbbr(abbr: string): Region | null {
    return BY_ABBR.get(abbr.trim().toUpperCase()) ?? null;
  },
  /** The region whose URL segment is exactly `slug`. */
  fromSlug(slug: string): Region | null {
    return BY_SLUG.get(slug) ?? null;
  },
} as const;
