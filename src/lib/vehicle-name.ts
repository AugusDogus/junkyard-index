import { Slug } from "./slug";

// Makes that providers abbreviate or spell short.
const MAKE_ALIASES: Readonly<Record<string, string>> = {
  VW: "VOLKSWAGEN",
  MERCEDES: "MERCEDESBENZ",
  CHEVY: "CHEVROLET",
};

// Values providers put in the make field that aren't makes.
const NOT_MAKES = new Set(["", "OTHER", "MISC", "UNKNOWN", "YELLOW", "AM"]);

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
  const [first, ...rest] = model.trim().split(/\s+/);
  const remainder = rest.join(" ");
  const strip =
    first !== undefined &&
    rest.length > 0 &&
    VehicleName.makeKey(first) === VehicleName.makeKey(make) &&
    /[A-Za-z]/.test(remainder);
  return strip ? remainder : model.trim();
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
    if (VehicleName.makeKey(model) === makeKey) return null;
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
    return (mixed ?? top)[0];
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
