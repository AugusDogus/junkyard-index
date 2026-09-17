import { z } from "zod";
import { INGESTION_SOURCES } from "./ingestion-source";
import { hasFiniteCoordinates } from "./location-preferences";

const nullableText = z
  .string()
  .trim()
  .transform((value) => value || null)
  .nullable();
const schema = z
  .object({
    source: z.enum(INGESTION_SOURCES),
    code: z.string().trim().min(1),
    name: z.string().trim().min(1),
    operator: nullableText,
    address: nullableText,
    city: z.string().trim().min(1),
    state: z.string().trim(),
    postalCode: nullableText,
    lat: z.number().finite().min(-90).max(90).nullable(),
    lng: z.number().finite().min(-180).max(180).nullable(),
    websiteUrl: z.string().url().nullable().transform(website),
    phone: nullableText,
    email: z.string().email().nullable(),
  })
  .refine((value) => (value.lat === null) === (value.lng === null), {
    message: "Yard latitude and longitude must both be present or both be null",
  });

export type Yard = z.infer<typeof schema>;

const sharedHosts = new Set([
  "pullapart.com",
  "upullandpay.com",
  "pyp.com",
  "gopullit.com",
  "upullitne.com",
  "picknpull.com",
  "lkqpickyourpart.com",
]);

function website(raw: string | null): string | null {
  const url = raw ? URL.parse(raw) : null;
  if (
    !url ||
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    return null;
  const host = url.hostname.replace(/^www\./, "");
  const hostedAutoRecyclerYard =
    url.protocol === "https:" &&
    ((url.hostname === "app.autorecycler.io" &&
      /^\/inventory\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)) ||
      (url.hostname === "ario.autorecycler.io" &&
        /^\/yard\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)));
  if (
    !hostedAutoRecyclerYard &&
    ["row52.com", "autorecycler.io"].some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    )
  )
    return null;
  if (
    sharedHosts.has(host) &&
    (url.pathname === "/" ||
      /^\/(locations|inventory|search-inventory)\/?$/.test(url.pathname))
  )
    return null;
  url.hash = "";
  return url.href;
}

export const Yard = {
  parse(input: unknown) {
    return schema.safeParse(input);
  },
  website,
  coordinates(lat: number | null, lng: number | null) {
    const coordinates = { lat, lng };
    return hasFiniteCoordinates(coordinates) && (lat !== 0 || lng !== 0)
      ? coordinates
      : { lat: null, lng: null };
  },
} as const;
