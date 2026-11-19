type YardAddressInput = {
  address: string | null;
  city: string;
  state: string;
  postalCode?: string | null;
};

/** Remove only a locality suffix that matches the yard's explicit fields. */
function normalize({
  address,
  city,
  state,
  postalCode = null,
}: YardAddressInput): { address: string | null; postalCode: string | null } {
  if (!address) return { address: null, postalCode };
  const parts = address.split(",").map((part) => part.trim());
  const same = (left: string, right: string) =>
    left.toLowerCase() === right.toLowerCase();
  while (parts.length >= 3) {
    const end =
      /^(?:usa|us|united states|united states of america|canada)$/i.test(
        parts.at(-1) ?? "",
      )
        ? parts.length - 1
        : parts.length;
    const place = parts[end - 2];
    const regionAndPostal = parts[end - 1] ?? "";
    const postal = /\s+(\d{5}(?:-\d{4})?|[A-Z]\d[A-Z]\s?\d[A-Z]\d)$/i.exec(
      regionAndPostal,
    );
    const region = postal
      ? regionAndPostal.slice(0, postal.index)
      : regionAndPostal;
    if (!place || !region || !same(place, city) || !same(region, state)) break;
    if (postal?.[1] && postalCode && !same(postal[1], postalCode)) break;
    postalCode ??= postal?.[1] ?? null;
    parts.splice(end - 2);
  }
  return { address: parts.join(", ") || null, postalCode };
}

export const YardAddress = {
  normalize,
  street(input: YardAddressInput): string | null {
    return normalize(input).address;
  },
  format(input: YardAddressInput): string {
    const normalized = normalize(input);
    return [
      normalized.address,
      `${input.city}, ${input.state}`,
      normalized.postalCode,
    ]
      .filter(Boolean)
      .join(", ");
  },
} as const;
