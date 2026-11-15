import { z } from "zod";
import type { Yard } from "~/lib/yard";
import { HAGERMAN_ORIGIN } from "./hagerman-parser";

export const HagermanCoordinatesSchema = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
  })
  .strict()
  .refine(({ lat, lng }) => lat !== 0 || lng !== 0, {
    message: "Supply independently validated Umatilla yard coordinates",
  });
export type HagermanCoordinates = z.infer<typeof HagermanCoordinatesSchema>;
export type HagermanYard = Omit<Yard, "source"> & { source: "hagerman" };

// Census exact-address result, captured 2026-11-15T04:27:28.964242Z.
// Street-range interpolation (82899 through 82891), not rooftop or parcel precision.
export const HAGERMAN_COORDINATES: HagermanCoordinates = {
  lat: 45.919115087534,
  lng: -119.276244647724,
};

/** All five qualified native store 1 donors identify this address. Salem is not emitted. */
export const HagermanYard = {
  create(coordinates: HagermanCoordinates): HagermanYard & HagermanCoordinates {
    return {
      source: "hagerman",
      code: "umatilla",
      name: "Hagerman, Inc. - Umatilla",
      operator: "Hagerman, Inc.",
      address: "82891 Bud Draper Road",
      city: "Umatilla",
      state: "OR",
      postalCode: "97882",
      phone: "5419226455",
      email: "partsales@hagermanparts.com",
      websiteUrl: HAGERMAN_ORIGIN,
      ...HagermanCoordinatesSchema.parse(coordinates),
    };
  },
} as const;
