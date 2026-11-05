/** URL path segments made from display names. */
export const Slug = {
  /**
   * Lowercase ASCII words joined by hyphens: "Paul's - Lake Station" becomes
   * "pauls-lake-station". Accents fold to their base letter and "&" reads as
   * "and", so names that differ only in punctuation share a slug.
   */
  from(value: string): string {
    return value
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  },
} as const;
