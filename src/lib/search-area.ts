import { z } from "zod";
import { SearchRadius } from "./search-radius";

const schema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  radiusMiles: z.union([
    z.literal(25),
    z.literal(50),
    z.literal(100),
    z.literal(250),
    z.literal(500),
  ]),
});
export type SearchArea = z.infer<typeof schema>;

function fromUrl(params: URLSearchParams): SearchArea | undefined {
  const lat = params.get("lat")?.trim();
  const lng = params.get("lng")?.trim();
  if (!lat || !lng) return undefined;
  const parsed = schema.safeParse({
    lat: Number(lat),
    lng: Number(lng),
    radiusMiles: SearchRadius.parse(params.get("radius")),
  });
  return parsed.success ? parsed.data : undefined;
}

function params(area: SearchArea | undefined) {
  return area
    ? {
        aroundLatLng: `${area.lat}, ${area.lng}`,
        aroundRadius: SearchRadius.meters(area.radiusMiles),
      }
    : {};
}

export const SearchArea = { schema, fromUrl, params } as const;
