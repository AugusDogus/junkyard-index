const REGION_NAME_TO_ABBR = new Map<string, string>(
  [
    ["alabama", "AL"],
    ["alaska", "AK"],
    ["arizona", "AZ"],
    ["arkansas", "AR"],
    ["california", "CA"],
    ["colorado", "CO"],
    ["connecticut", "CT"],
    ["delaware", "DE"],
    ["district of columbia", "DC"],
    ["florida", "FL"],
    ["georgia", "GA"],
    ["hawaii", "HI"],
    ["idaho", "ID"],
    ["illinois", "IL"],
    ["indiana", "IN"],
    ["iowa", "IA"],
    ["kansas", "KS"],
    ["kentucky", "KY"],
    ["louisiana", "LA"],
    ["maine", "ME"],
    ["maryland", "MD"],
    ["massachusetts", "MA"],
    ["michigan", "MI"],
    ["minnesota", "MN"],
    ["mississippi", "MS"],
    ["missouri", "MO"],
    ["montana", "MT"],
    ["nebraska", "NE"],
    ["nevada", "NV"],
    ["new hampshire", "NH"],
    ["new jersey", "NJ"],
    ["new mexico", "NM"],
    ["new york", "NY"],
    ["north carolina", "NC"],
    ["north dakota", "ND"],
    ["ohio", "OH"],
    ["oklahoma", "OK"],
    ["oregon", "OR"],
    ["pennsylvania", "PA"],
    ["rhode island", "RI"],
    ["south carolina", "SC"],
    ["south dakota", "SD"],
    ["tennessee", "TN"],
    ["texas", "TX"],
    ["utah", "UT"],
    ["vermont", "VT"],
    ["virginia", "VA"],
    ["washington", "WA"],
    ["west virginia", "WV"],
    ["wisconsin", "WI"],
    ["wyoming", "WY"],
    ["alberta", "AB"],
    ["british columbia", "BC"],
    ["manitoba", "MB"],
    ["new brunswick", "NB"],
    ["newfoundland and labrador", "NL"],
    ["nova scotia", "NS"],
    ["ontario", "ON"],
    ["prince edward island", "PE"],
    ["quebec", "QC"],
    ["saskatchewan", "SK"],
    ["northwest territories", "NT"],
    ["nunavut", "NU"],
    ["yukon", "YT"],
  ] as const,
);

const REGION_ABBR_TO_NAME = new Map<string, string>(
  [...REGION_NAME_TO_ABBR.entries()].map(([name, abbr]) => [abbr, toTitleCase(name)]),
);

const MULTIWORD_MAKES = [
  "Alfa Romeo",
  "Aston Martin",
  "Land Rover",
  "Mercedes-Benz",
  "Rolls-Royce",
] as const;

const MAKE_DISPLAY_OVERRIDES: Record<string, string> = {
  amc: "AMC",
  bmw: "BMW",
  gmc: "GMC",
  mg: "MG",
  vpg: "VPG",
  vam: "VAM",
};

const COLOR_ALIASES: Record<string, string> = {
  blk: "Black",
  blu: "Blue",
  brn: "Brown",
  brz: "Bronze",
  burg: "Burgundy",
  char: "Charcoal",
  gld: "Gold",
  grn: "Green",
  gry: "Gray",
  grey: "Gray",
  mrn: "Maroon",
  org: "Orange",
  pur: "Purple",
  sil: "Silver",
  tan: "Tan",
  wht: "White",
  yel: "Yellow",
  "grey/silver": "Silver",
};

function toTitleCase(value: string): string {
  return value.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function toDisplayCase(value: string): string {
  return toTitleCase(value);
}

export function normalizeRegion(
  state: string,
  stateAbbr?: string | null,
): { state: string; stateAbbr: string } {
  const rawState = state.trim();
  const rawStateAbbr = stateAbbr?.trim().toUpperCase() ?? "";

  if (rawStateAbbr.length > 0) {
    return {
      state:
        REGION_ABBR_TO_NAME.get(rawStateAbbr) ??
        (rawState || rawStateAbbr),
      stateAbbr: rawStateAbbr,
    };
  }

  const upperState = rawState.toUpperCase();
  if (upperState.length > 0 && REGION_ABBR_TO_NAME.has(upperState)) {
    return {
      state: REGION_ABBR_TO_NAME.get(upperState) ?? rawState,
      stateAbbr: upperState,
    };
  }

  const inferredAbbr = REGION_NAME_TO_ABBR.get(rawState.toLowerCase()) ?? "";
  return {
    state: rawState,
    stateAbbr: inferredAbbr,
  };
}

function normalizeParsedMake(make: string): string {
  return normalizeCanonicalMake(make);
}

export function normalizeCanonicalMake(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^\d{4}$/.test(trimmed)) {
    return "Other";
  }

  const normalized = trimmed.toLowerCase();
  return MAKE_DISPLAY_OVERRIDES[normalized] ?? toDisplayCase(trimmed);
}

export function normalizeCanonicalColor(value: string | null): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const unwrapped = trimmed.replace(/^\[(.+)\]$/, "$1").trim();
  if (!unwrapped) return null;

  const normalized = unwrapped.toLowerCase();
  if (normalized === "unknown" || normalized === "other") {
    return null;
  }

  return COLOR_ALIASES[normalized] ?? toDisplayCase(unwrapped);
}

export function parseAutorecyclerMakeModel(rest: string): {
  make: string;
  model: string;
} {
  const trimmed = rest.trim();
  const upper = trimmed.toUpperCase();

  for (const candidate of MULTIWORD_MAKES) {
    const upperCandidate = candidate.toUpperCase();
    if (upper === upperCandidate || upper.startsWith(`${upperCandidate} `)) {
      const make = trimmed.slice(0, candidate.length).trim();
      const model = trimmed.slice(candidate.length).trim();
      return {
        make: normalizeParsedMake(make),
        model: model || make,
      };
    }
  }

  const space = trimmed.indexOf(" ");
  if (space === -1) {
    const make = normalizeParsedMake(trimmed);
    return { make, model: trimmed };
  }

  const make = normalizeParsedMake(trimmed.slice(0, space));
  const model = trimmed.slice(space + 1).trim();
  return {
    make,
    model: model || make,
  };
}
