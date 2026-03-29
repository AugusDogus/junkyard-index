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

const CANONICAL_MAKES = [
  "Acura",
  "Alfa Romeo",
  "AMC",
  "Aston Martin",
  "Audi",
  "BMW",
  "Buick",
  "Cadillac",
  "Chevrolet",
  "Chrysler",
  "Daihatsu",
  "Datsun",
  "Daewoo",
  "Dodge",
  "Eagle",
  "Fiat",
  "Ford",
  "Genesis",
  "Geo",
  "GMC",
  "Honda",
  "Hummer",
  "Hyundai",
  "Infiniti",
  "International",
  "Isuzu",
  "Jaguar",
  "Jeep",
  "Kia",
  "Land Rover",
  "Lexus",
  "Lincoln",
  "Mazda",
  "Mercedes-Benz",
  "Mercury",
  "MG",
  "Mini",
  "Mitsubishi",
  "Nissan",
  "Oldsmobile",
  "Opel",
  "Peugeot",
  "Plymouth",
  "Pontiac",
  "Porsche",
  "Qvale",
  "Ram",
  "Rolls-Royce",
  "Saab",
  "Saturn",
  "Scion",
  "Subaru",
  "Suzuki",
  "Toyota",
  "Triumph",
  "VAM",
  "Volkswagen",
  "Volvo",
  "VPG",
  "Yugo",
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

function normalizeComparableMake(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, " ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COMPARABLE_CANONICAL_MAKES = new Map(
  CANONICAL_MAKES.map((make) => [normalizeComparableMake(make), make] as const),
);

const CANONICAL_MAKE_PREFIX_PATTERNS = [...CANONICAL_MAKES]
  .sort((left, right) => right.length - left.length)
  .map((make) => ({
    make,
    pattern: new RegExp(
      `^${make
        .split(/[-\s]+/)
        .map((part) => escapeRegex(part))
        .join("[-\\s]+")}(?:\\s+|$)`,
      "i",
    ),
  }));
const MAX_MAKE_PARSE_INPUT_LENGTH = 100;

function matchCanonicalMake(value: string): string | null {
  const comparable = normalizeComparableMake(value);
  if (!comparable) return null;
  return COMPARABLE_CANONICAL_MAKES.get(comparable) ?? null;
}

function matchCanonicalMakePrefix(value: string): { make: string; end: number } | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_MAKE_PARSE_INPUT_LENGTH) {
    return null;
  }
  for (const { make, pattern } of CANONICAL_MAKE_PREFIX_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match) {
      return {
        make,
        end: match[0].length,
      };
    }
  }

  return null;
}

export function normalizeRegion(
  state: string,
  stateAbbr?: string | null,
): { state: string; stateAbbr: string } {
  const rawState = state.trim();
  const rawStateAbbr = stateAbbr?.trim().toUpperCase() ?? "";

  if (rawState.length === 0 && rawStateAbbr.length === 0) {
    return {
      state: "Unknown",
      stateAbbr: "",
    };
  }

  if (rawStateAbbr.length > 0) {
    const hasKnownStateAbbr = REGION_ABBR_TO_NAME.has(rawStateAbbr);
    return {
      state:
        REGION_ABBR_TO_NAME.get(rawStateAbbr) ??
        (rawState || rawStateAbbr),
      stateAbbr: hasKnownStateAbbr ? rawStateAbbr : "",
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
  if (inferredAbbr) {
    return {
      state: REGION_ABBR_TO_NAME.get(inferredAbbr) ?? toTitleCase(rawState),
      stateAbbr: inferredAbbr,
    };
  }

  return {
    state: rawState,
    stateAbbr: "",
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

  const canonical = matchCanonicalMake(trimmed);
  if (canonical) {
    return canonical;
  }

  const normalized = trimmed.toLowerCase();
  return MAKE_DISPLAY_OVERRIDES[normalized] ?? toTitleCase(trimmed);
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

  return COLOR_ALIASES[normalized] ?? toTitleCase(unwrapped);
}

export function parseAutorecyclerMakeModel(rest: string): {
  make: string;
  model: string;
} {
  const trimmed = rest.trim();
  const canonicalPrefix = matchCanonicalMakePrefix(trimmed);
  if (canonicalPrefix) {
    const model = trimmed.slice(canonicalPrefix.end).trim();
    return {
      make: canonicalPrefix.make,
      model: model || canonicalPrefix.make,
    };
  }

  const space = trimmed.indexOf(" ");
  if (space === -1) {
    const make = normalizeParsedMake(trimmed);
    return { make, model: make };
  }

  const make = normalizeParsedMake(trimmed.slice(0, space));
  const model = trimmed.slice(space + 1).trim();
  return {
    make,
    model: model || make,
  };
}
