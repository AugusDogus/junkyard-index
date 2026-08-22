import { z } from "zod";

/**
 * Normalizes and validates a visitor-supplied yard website URL.
 *
 * Schemeless inputs get `https://` prepended; userinfo credentials are
 * stripped; only http(s) URLs with a dotted hostname survive validation.
 */
export const yardRequestWebsiteSchema = z
  .string()
  .trim()
  .max(500)
  .transform((s) => {
    const candidate = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    try {
      const url = new URL(candidate);
      url.username = "";
      url.password = "";
      return url.toString();
    } catch {
      return candidate;
    }
  })
  .refine(
    (s) => {
      try {
        const url = new URL(s);
        return (
          (url.protocol === "https:" || url.protocol === "http:") &&
          /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname)
        );
      } catch {
        return false;
      }
    },
    { message: "Website must be a valid URL" },
  );
