type YardNameInput = {
  source: string;
  name: string;
  city: string;
  operator?: string | null;
  inventoryUrl?: string | null;
};

// Preserve established spellings after casing unformatted source names.
const BRANDS: Readonly<Record<string, string>> = {
  lkq: "LKQ",
  usa: "USA",
  llc: "LLC",
  gmc: "GMC",
  byot: "BYOT",
  "pick-n-pull": "PICK-n-PULL",
  "pull-a-part": "Pull-A-Part",
  "u-pull-&-pay": "U-Pull-&-Pay",
};

function display(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => {
      const brand = BRANDS[word.toLowerCase()];
      if (brand) return brand;
      // Keep deliberate mixed-case branding, such as AutoZone or eBay.
      if (word !== word.toUpperCase() && word !== word.toLowerCase())
        return word;
      return word
        .toLowerCase()
        .replace(/(^|[-/])[a-z]/g, (letter) => letter.toUpperCase());
    })
    .join(" ");
}

function resolve({
  source,
  name: rawName,
  city,
  operator,
  inventoryUrl,
}: YardNameInput): string {
  const name = display(rawName);
  if (source === "pyp") {
    return /pick your part/i.test(name) ? name : `LKQ Pick Your Part - ${name}`;
  }
  if (operator && name.trim().toLowerCase() === city.trim().toLowerCase())
    return `${operator} - ${name}`;
  if (
    source === "pullapart" &&
    !/pull[\s-]*a[\s-]*part|u[\s-]*pull/i.test(name)
  ) {
    const host = inventoryUrl ? URL.parse(inventoryUrl)?.hostname : null;
    const brand =
      operator ??
      (host === "www.upullandpay.com"
        ? "U-Pull-&-Pay"
        : host === "www.pullapart.com"
          ? "Pull-A-Part"
          : "Pull-A-Part / U-Pull-&-Pay");
    return `${brand} - ${name}`;
  }
  return name;
}

export const YardName = {
  display,
  resolve,
  /**
   * The name people search for. A yard listed under a short brand whose
   * operator extends it ("Pick Your Part - Sun Valley", run by "LKQ Pick Your
   * Part") reads as "LKQ Pick Your Part - Sun Valley"; other names are kept.
   */
  headline(name: string, operator: string | null): string {
    const [brand, ...location] = name.split(" - ");
    if (
      !operator ||
      !brand ||
      location.length === 0 ||
      operator.toLowerCase() === brand.toLowerCase() ||
      !operator.toLowerCase().endsWith(brand.toLowerCase())
    ) {
      return name;
    }
    return [operator, ...location].join(" - ");
  },
} as const;
