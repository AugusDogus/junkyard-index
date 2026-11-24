import { Slug } from "./slug";

// Makes that providers abbreviate or spell short.
const MAKE_ALIASES: Readonly<Record<string, string>> = {
  VW: "VOLKSWAGEN",
  MERCEDES: "MERCEDESBENZ",
  CHEVY: "CHEVROLET",
  FERRARY: "FERRARI",
  NISSIAN: "NISSAN",
  OLDMOBILE: "OLDSMOBILE",
  MITSIBISHI: "MITSUBISHI",
  PETERBUILT: "PETERBILT",
  CHEVROLETTE: "CHEVROLET",
  INFINITY: "INFINITI",
  DATSUNNISSAN: "NISSAN",
  NISSANDATSUN: "NISSAN",
  RANGEROVER: "LANDROVER",
  MINICOOPER: "MINI",
  AMERICANMOTORS: "AMC",
  RAMTRUCKS: "RAM",
  MBENZ: "MERCEDESBENZ",
  IC: "ICCORPORATION",
  ICBUS: "ICCORPORATION",
};

// Values providers put in the make field that aren't makes.
const NOT_MAKES = new Set(["", "OTHER", "MISC", "UNKNOWN", "YELLOW", "AM"]);
// These aliases correct a make field but remain meaningful model names.
const MODEL_MAKE_ALIASES = new Set(["RANGEROVER", "MINICOOPER"]);

// Exact catalog labels in Pratt, Allied, Midway, Northwest, TAP and Ario
// fixtures. Bare "1500 Pickup" and "Ram Pickup" cannot identify a model.
const PICKUP_MODELS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  FORD: {
    F100: "F-100",
    F150: "F-150",
    F250: "F-250",
    F350: "F-350",
    F450: "F-450",
    F250SD: "F-250 Super Duty",
    F250SUPERDUTY: "F-250 Super Duty",
    F350SD: "F-350 Super Duty",
    F350SUPERDUTY: "F-350 Super Duty",
    F450SD: "F-450 Super Duty",
    F450SUPERDUTY: "F-450 Super Duty",
  },
  CHEVROLET: {
    SILVERADO1500: "Silverado 1500",
    SILVERADO2500: "Silverado 2500",
    SILVERADO3500: "Silverado 3500",
  },
  TOYOTA: { T100: "T100" },
};

// Values providers put in the model field that name no model.
const NOT_MODELS = new Set([
  "MOTORCYCLE",
  "UNKNOWN",
  "OTHER",
  "MISC",
  "NA",
  "NONE",
]);

// Trim, body, and drive labels yards append to a model ("Accord EX",
// "CIVIC4DR.SDN.", "ELEMENT SW. 4WD."). Only common, unambiguous labels:
// words that also finish model names ("Sport" in "Range Rover Sport",
// "Coupe" in "Genesis Coupe", "Van" in "Ram Van", "Hybrid", "Si") are kept.
const MODEL_LABELS = new Set([
  ...["DX", "LX", "EX", "EXL", "SE", "LE", "XLE", "SR5", "LT", "LS", "XLT"],
  ...["SLE", "SLT", "GLS", "SEL", "XSE", "XLS", "HSE", "CE", "TOURING"],
  ...["ELITE", "BASE"],
  ...["2DR", "3DR", "4DR", "5DR", "SDN", "SEDAN", "CP", "SW", "WGN"],
  ...["WAGON", "HB", "HATCHBACK", "CONV"],
  ...["2WD", "4WD", "AWD", "FWD", "RWD", "4X4", "4X2"],
]);

/** A model year a yard appended to a model name ("Civic 2009"). */
function isModelYear(word: string): boolean {
  return /^\d{4}$/.test(word) && Number(word) >= 1981 && Number(word) <= 2100;
}

/** A word as compared with the labels: "SW." is "SW", "EX-L" is "EXL". */
function labelKey(word: string): string {
  return word.toUpperCase().replace(/[-.]/g, "");
}

/**
 * The model without the labels yards append ("Accord 4DR. LX" is "Accord").
 * Labels are only dropped from the end, never the first word, and never
 * down to a bare number ("300 SE" stays), so the rest still names a model.
 * Dots only separate words between letters ("CIVIC4DR.SDN."), so "5.0" stays.
 */
function withoutLabels(model: string): string {
  const words = model
    .trim()
    .split(/\s+/)
    .flatMap((word) => {
      const parts = word.split(".").filter(Boolean);
      return parts.length > 1 && parts.every((part) => /[A-Za-z]/.test(part))
        ? parts
        : [word];
    });
  let end = words.length;
  while (end > 1) {
    const rest = (count: number) =>
      /^\d+$/.test(words.slice(0, end - count).join(""));
    const last = labelKey(words[end - 1] ?? "");
    // A label a URL slug split in two ("ex l" for "EX-L").
    const pair = end > 2 ? labelKey(words[end - 2] ?? "") + last : "";
    if (pair && MODEL_LABELS.has(pair) && !rest(2)) end -= 2;
    else if ((MODEL_LABELS.has(last) || isModelYear(last)) && !rest(1)) end--;
    else break;
  }
  // A door count glued to the model ("CIVIC4DR").
  const last = (words[end - 1] ?? "")
    .replace(/\.$/, "")
    .replace(/(?<=[A-Za-z])[2-5]DR$/i, "");
  if (end === words.length && last === words[end - 1]) return model.trim();
  return [...words.slice(0, end - 1), last].join(" ");
}

// A mixed-case spelling must be this common, relative to the most common
// spelling, to be shown instead of it: one "Rx 300" doesn't outvote 154 "RX 300".
const MIXED_CASE_SHARE = 0.1;

/**
 * Identity for comparing names: what `Slug.from` keeps, without separators.
 * So "Town & Country" and "TOWN AND COUNTRY" match, as their URLs would.
 */
function key(value: string): string {
  return Slug.from(value).replace(/-/g, "").toUpperCase();
}

/**
 * The model as written, without a leading make ("BMW 328i" is "328i"), unless
 * only a number would remain ("MAZDA 3" stays as written).
 */
function modelName(make: string, model: string): string {
  const words = model.trim().split(/\s+/);
  let name = model.trim();
  const makeKey = VehicleName.makeKey(make);
  // Match whole tokens so multiword makes work without truncating Mazda3.
  for (let end = 1; end < words.length; end++) {
    const remainder = words.slice(end).join(" ");
    if (
      makeKey &&
      !MODEL_MAKE_ALIASES.has(key(words.slice(0, end).join(" "))) &&
      VehicleName.makeKey(words.slice(0, end).join(" ")) === makeKey &&
      /[A-Za-z]/.test(remainder)
    ) {
      name = remainder;
      break;
    }
  }
  const base = name.replace(/\s+pickup$/i, "");
  return PICKUP_MODELS[makeKey ?? ""]?.[key(base)] ?? name;
}

// Short words that are words, not codes, after another word ("SANTA FE",
// "TOWN CAR", "GRAND AM", "RAM VAN"). Leading, they could be initials ("AM
// General").
const SHORT_WORDS_AFTER = new Set(["FE", "CAR", "AM", "VAN", "BUS", "CAB"]);
// Short words that open a longer name ("EL CAMINO", "NEW YORKER"). Alone or
// last, "LE" and "SE" are trims, so only an opening word before another word
// softens.
const SHORT_WORDS_OPENING = new Set(["NEW", "EL", "LA", "DE", "RAM"]);
// "LE" also opens trims ("LE V6", "LE PREMIUM"), so it softens only before the
// model names it begins.
const LE_MODELS = /^(sabre|mans|baron)\b/i;

function titleCase(word: string): string {
  return word.charAt(0) + word.slice(1).toLowerCase();
}

/**
 * An all-caps name with its plain words title-cased ("CIVIC CRX" → "Civic
 * CRX", "F-250 SUPER DUTY" → "F-250 Super Duty", "SANTA FE" → "Santa Fe").
 * Other words of three letters or fewer, and anything with digits or
 * hyphens, keep their capitals, since those are usually initials, model
 * codes, or trims (BMW, GMC, CR-V, MAZDA3, LE).
 */
function softenCaps(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name
    .replace(/\b[A-Z]{4,}\b/g, titleCase)
    .replace(
      /(?<!\S)[A-Z]{2,3}(?!\S)/g,
      (word: string, offset: number, whole: string) => {
        const before = whole.slice(0, offset).trim();
        const after = whole.slice(offset + word.length).trim();
        if (word === "AND" && before && after) return "and";
        if (before && SHORT_WORDS_AFTER.has(word)) return titleCase(word);
        if (!before && after && SHORT_WORDS_OPENING.has(word))
          return titleCase(word);
        if (!before && word === "LE" && LE_MODELS.test(after))
          return titleCase(word);
        return word;
      },
    );
}

export const VehicleName = {
  /**
   * The make's identity across spellings ("Vw" and "Volkswagen" share one),
   * or null for placeholders such as "Other".
   */
  makeKey(make: string): string | null {
    const base = key(make);
    if (NOT_MAKES.has(base)) return null;
    return MAKE_ALIASES[base] ?? base;
  },

  /** Canonical names for unambiguous make aliases, even without a long spelling. */
  makeName(make: string): string {
    const canonical: Readonly<Record<string, string>> = {
      VOLKSWAGEN: "Volkswagen",
      MERCEDESBENZ: "Mercedes-Benz",
      CHEVROLET: "Chevrolet",
      FERRARI: "Ferrari",
      NISSAN: "Nissan",
      OLDSMOBILE: "Oldsmobile",
      MITSUBISHI: "Mitsubishi",
      PETERBILT: "Peterbilt",
      INFINITI: "Infiniti",
      LANDROVER: "Land Rover",
      MINI: "Mini",
      AMC: "AMC",
      RAM: "Ram",
      ICCORPORATION: "IC Corporation",
      // A historical truck manufacturer, not an alias for Volvo or GMC.
      VOLVOWHITEGMC: "Volvo White GMC",
    };
    return (
      canonical[VehicleName.makeKey(make) ?? ""] ?? VehicleName.display(make)
    );
  },

  modelName,

  /**
   * `modelName` without the trim, body, drive, and year labels yards append:
   * "CIVIC4DR.SDN." is "CIVIC" and "FORD F150 XLT" is "F-150".
   */
  baseModelName(make: string, model: string): string {
    // Drop the make first, so "Lexus LS" keeps its model.
    return modelName(make, withoutLabels(modelName(make, model)));
  },

  /**
   * The model's identity across spellings: case, punctuation, "&" and "and",
   * a repeated make ("BMW 328I" is "328I"), appended labels ("Accord EX" is
   * "ACCORD"), and bare numbers, which take the make ("3", "Mazda3", and
   * "MAZDA 3" are all "MAZDA3"). Null when nothing is left, the model only
   * repeats the make ("Dodge" for a Dodge), or it is a placeholder
   * ("Motorcycle").
   */
  modelKey(make: string, model: string): string | null {
    const makeKey = VehicleName.makeKey(make);
    const stripped = withoutLabels(modelName(make, model));
    const base = key(modelName(make, stripped));
    if (!base || !makeKey || NOT_MODELS.has(key(model))) return null;
    if (
      !MODEL_MAKE_ALIASES.has(key(stripped)) &&
      VehicleName.makeKey(stripped) === makeKey
    )
      return null;
    if (/^\d+$/.test(base)) return `${makeKey}${base}`;
    return base;
  },

  /**
   * What to call a model next to its make: "Fiat 500", "Ford F-150", and
   * "Mazda3", where the model already starts with the make.
   */
  title(make: string, model: string): string {
    const makeKey = VehicleName.makeKey(make);
    const own = key(model);
    return makeKey && own.startsWith(makeKey) && own !== makeKey
      ? model
      : `${make} ${model}`;
  },

  /**
   * The spelling to show: the most common, unless a mixed-case spelling is
   * reasonably common too, which reads better than all caps ("Accord" over
   * "ACCORD"). Ties go to the alphabetically first spelling.
   */
  preferredSpelling(spellings: ReadonlyMap<string, number>): string {
    const ranked = [...spellings.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    const top = ranked[0];
    if (!top) return "";
    const mixed = ranked.find(
      ([name, count]) =>
        name !== name.toUpperCase() && count >= top[1] * MIXED_CASE_SHARE,
    );
    return mixed ? mixed[0] : softenCaps(top[0]);
  },

  /** A raw make, model, or trim as displayed; see `softenCaps`. */
  display(name: string): string {
    return softenCaps(name);
  },

  slug(name: string): string {
    return Slug.from(name);
  },

  /** Whether two URL segments name the same thing ("mazda3", "Mazda-3"). */
  sameSlug(a: string, b: string): boolean {
    const plain = (value: string) => value.replace(/-/g, "").toLowerCase();
    return plain(a) === plain(b);
  },
} as const;
