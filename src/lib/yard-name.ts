type YardNameInput = {
  source: string;
  name: string;
  city: string;
  operator?: string | null;
  inventoryUrl?: string | null;
};

function resolve({
  source,
  name,
  city,
  operator,
  inventoryUrl,
}: YardNameInput): string {
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
