import { z } from "zod";

const origin = "https://return-to.invalid";
const pathSchema = z
  .string()
  .refine(
    (value) =>
      value.startsWith("/") &&
      !/^\/[\\/]/.test(value) &&
      !value.includes("\\") &&
      Array.from(value).every(
        (character) =>
          character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127,
      ),
  )
  .brand<"ReturnTo">();

export type ReturnTo = z.infer<typeof pathSchema>;

/** URLSearchParams already decodes once. Also accept a once-encoded same-site path. */
function parse(input: unknown): ReturnTo {
  const fallback = pathSchema.parse("/search");
  if (typeof input !== "string") return fallback;
  let path = input;
  try {
    if (/^%2f/i.test(path)) path = decodeURIComponent(path);
    if (!pathSchema.safeParse(path).success) return fallback;
    const url = new URL(path, origin);
    if (url.origin !== origin) return fallback;
    // Dot-segment normalization can expose a leading double slash.
    const parsed = pathSchema.safeParse(url.pathname + url.search + url.hash);
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export const ReturnTo = { parse } as const;
