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

/**
 * An all-caps name with its plain words title-cased ("CIVIC CRX" → "Civic
 * CRX", "F-250 SUPER DUTY" → "F-250 Super Duty"). Words of three letters or
 * fewer, and anything with digits or hyphens, keep their capitals, since
 * those are usually initials or model codes (BMW, GMC, CR-V, MAZDA3).
 */
function softenCaps(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.replace(
    /\b[A-Z]{4,}\b/g,
    (word) => word.charAt(0) + word.slice(1).toLowerCase(),
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
   * The model's identity across spellings: case, punctuation, "&" and "and",
   * a repeated make ("BMW 328I" is "328I"), and bare numbers, which take the
   * make ("3", "Mazda3", and "MAZDA 3" are all "MAZDA3"). Null when nothing is
   * left or the model only repeats the make ("Dodge" for a Dodge).
   */
  modelKey(make: string, model: string): string | null {
    const makeKey = VehicleName.makeKey(make);
    const base = key(modelName(make, model));
    if (!base || !makeKey) return null;
    if (
      !MODEL_MAKE_ALIASES.has(key(model)) &&
      VehicleName.makeKey(model) === makeKey
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
