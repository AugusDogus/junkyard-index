import { VehicleName } from "./vehicle-name";

export type ConsumerModel = {
  make: string;
  model: string;
  series?: string | null;
  series2?: string | null;
  trim?: string | null;
  driveType?: string | null;
  electrificationLevel?: string | null;
  sourceModel?: string | null;
};

const key = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Explicit consumer-name aliases, scoped to a make. No platform-code guessing. */
const NAMES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  CHEVROLET: { S10PICKUP: "S-10", ASTROVAN: "Astro" },
  TOYOTA: { COROLLAMATRIX: "Matrix", CAMRYSOLARA: "Solara" },
};
const SOURCE_NAMES: Readonly<Record<string, Readonly<Record<string, string>>>> =
  {
    FORD: {
      F150NEW: "F-150",
      F150OLD: "F-150",
      TFORD150: "F-150",
      VFORD150: "F-150",
      TRUCKF150: "F-150",
      PICKUPF150: "F-150",
    },
    CHEVROLET: {
      SILVRDO15: "Silverado 1500",
      SILVRDO25: "Silverado 2500",
      SILVRDO35: "Silverado 3500",
      EXPRESS15: "Express 1500",
      EXPRESS25: "Express 2500",
      EXPRESS35: "Express 3500",
    },
    SCION: { TCSCION: "tC", XASCION: "xA", XBSCION: "xB", XDSCION: "xD" },
  };
const RATINGS: Readonly<Record<string, string>> = {
  "1500": "1500",
  "150012TON": "1500",
  "12TON": "1500",
  "12TONNOMINAL": "1500",
  "2500": "2500",
  "250034TON": "2500",
  "34TON": "2500",
  "34TONNOMINAL": "2500",
  "3500": "3500",
  "35001TON": "3500",
  "1TON": "3500",
  "1TONNOMINAL": "3500",
  "1500HD": "1500HD",
  "2500HD": "2500HD",
  "3500HD": "3500HD",
  "4500": "4500",
  "4500CUTAWAY": "4500 Cutaway",
};
const RATED_GM_MODELS = new Set([
  "SILVERADO",
  "SIERRA",
  "SUBURBAN",
  "EXPRESS",
  "SAVANA",
  "YUKONXL",
]);
const CIVIC_VARIANTS: Readonly<Record<string, string>> = {
  HYBRID: "Hybrid",
  SI: "Si",
  SIR: "SiR",
  TYPER: "Type R",
  GX: "GX",
  NATURALGAS: "Natural Gas",
};

function withoutYear(name: string): string {
  return name.replace(/\s+(\d{4})$/, (suffix, year: string) =>
    Number(year) >= 1981 && Number(year) <= 2100 ? "" : suffix,
  );
}

function ratedModel(
  base: string,
  rating: string | undefined,
  source: string | null,
): string {
  if (!rating)
    return source && key(source).startsWith(key(base)) ? source : base;
  // Keep Classic/HD and unknown source variants even when their words precede
  // the rating. A contradictory source rating cannot override the clean VIN.
  const sourceRating = source?.match(/(?:1500|2500|3500|4500)(?:\s*HD)?/i)?.[0];
  if (
    source &&
    key(source).startsWith(key(base)) &&
    (!sourceRating ||
      key(sourceRating).replace(/HD$/, "") === key(rating).replace(/HD$/, ""))
  ) {
    const suffix = key(source).slice(key(base).length);
    if (suffix && suffix !== key(rating)) {
      if (!sourceRating)
        return `${base} ${rating} ${source.slice(base.length).trim()}`;
      return rating.endsWith("HD") && !key(sourceRating).endsWith("HD")
        ? source.replace(sourceRating, rating)
        : source;
    }
  }
  return `${base} ${rating}`;
}

function resolve(input: ConsumerModel): string {
  const make = VehicleName.makeKey(input.make) ?? key(input.make);
  const base = VehicleName.display(
    VehicleName.modelName(input.make, input.model),
  );
  const modelKey = key(base);
  const sourceName = input.sourceModel?.trim();
  const normalizedSource = sourceName
    ? VehicleName.display(VehicleName.modelName(input.make, sourceName))
    : null;
  const sourceAlias = sourceName
    ? SOURCE_NAMES[make]?.[key(sourceName)]
    : undefined;
  const aliasRating = sourceAlias?.match(/\b(\d{4})\b/)?.[1];
  const decodedRatings = [input.series, input.series2].flatMap((series) => {
    const rating = series?.trim().match(/^(\d{4})(?=\s|\(|HD|$)/i)?.[1];
    return rating ? [rating] : [];
  });
  // Even an unfamiliar decoded series rules out a contradictory yard alias.
  const conflictingAlias =
    aliasRating !== undefined &&
    decodedRatings.some((rating) => rating !== aliasRating);
  const source =
    sourceName && !conflictingAlias
      ? withoutYear(
          sourceAlias ??
            NAMES[make]?.[key(normalizedSource ?? "")] ??
            normalizedSource ??
            sourceName,
        )
      : null;
  let result = NAMES[make]?.[modelKey] ?? base;
  const gm = make === "CHEVROLET" || make === "GMC";
  const rating =
    RATINGS[key(input.series ?? "")] ?? RATINGS[key(input.series2 ?? "")];
  if (gm && (modelKey === "RCONVENTIONAL" || modelKey === "VCONVENTIONAL")) {
    // Chevrolet and GMC used different rating names for these platforms.
    // Keep the consumer label until a specific alias can explain it.
    return source || base;
  }
  if (gm && (modelKey === "SILVERADOHD" || modelKey === "SIERRAHD")) {
    const family = base.replace(/\s*HD$/i, "");
    const sourceRating = source?.match(/(?:2500|3500)(?:\s*HD)?/i)?.[0];
    const specificRating = rating ?? sourceRating;
    return specificRating
      ? ratedModel(
          family,
          `${key(specificRating).replace(/HD$/, "")}HD`,
          source,
        )
      : source && key(source) !== key(family)
        ? source
        : base;
  }
  if (
    gm &&
    (["GMT400", "CKPICKUP"].includes(modelKey) || RATED_GM_MODELS.has(modelKey))
  ) {
    // Labels not in this table are intentionally not interpreted as ratings.
    if (modelKey === "GMT400" || modelKey === "CKPICKUP") {
      const drive = input.driveType?.toUpperCase();
      const prefix =
        drive === "4X2"
          ? "C"
          : drive === "4WD/4-WHEEL DRIVE/4X4" || drive === "4X4"
            ? "K"
            : "C/K ";
      if (rating) {
        if (
          prefix === "C/K " &&
          source &&
          new RegExp(`^[CK]${rating}$`).test(key(source))
        )
          return source;
        return `${prefix}${rating}`;
      }
      // A source's C/K distinction is useful when vPIC supplies no series.
      return source || "C/K Pickup";
    }
    return ratedModel(base, rating, source);
  }
  if (
    make === "FORD" &&
    /^F(?:250|350|450|550)$/.test(modelKey) &&
    /super duty/i.test(`${input.series ?? ""} ${input.series2 ?? ""}`)
  )
    result = `${base} Super Duty`;
  if (make === "HONDA" && modelKey === "CIVIC") {
    const variant = [
      input.series,
      input.series2,
      input.trim,
      source && key(source).startsWith("CIVIC") ? key(source).slice(5) : null,
    ].flatMap((value) => {
      const name = CIVIC_VARIANTS[key(value ?? "")];
      return name ? [name] : [];
    })[0];
    if (variant) result = `${base} ${variant}`;
    else if (/\b(?:HEV|PHEV|hybrid)\b/i.test(input.electrificationLevel ?? ""))
      result = `${base} Hybrid`;
  }
  // Preserve a more specific source name within the same family when vPIC
  // has not explained that distinction. A source typo in another family
  // cannot override a clean VIN identity. Year suffixes are not variants.
  if (
    source &&
    key(source).startsWith(key(result)) &&
    key(source) !== key(result) &&
    source.length > result.length
  )
    return source;
  return result;
}

export const ConsumerModel = { resolve, sourceAliases: SOURCE_NAMES } as const;
