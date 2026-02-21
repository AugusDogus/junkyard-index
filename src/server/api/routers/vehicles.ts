import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DataSource, Vehicle } from "~/lib/types";
import { vehicle } from "~/schema";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

/**
 * Map a vehicle DB row to the Vehicle type.
 */
function dbVehicleToVehicle(
  v: typeof vehicle.$inferSelect,
): Vehicle {
  return {
    id: v.vin,
    year: v.year,
    make: v.make,
    model: v.model,
    color: v.color ?? "",
    vin: v.vin,
    stockNumber: v.stockNumber ?? "",
    availableDate: v.availableDate ?? "",
    source: v.source as DataSource,
    location: {
      locationCode: v.locationCode,
      locationPageURL: "",
      name: v.locationName,
      displayName: v.locationName.replace(/^Pick Your Part - /, ""),
      address: "",
      city: "",
      state: v.state,
      stateAbbr: v.stateAbbr,
      zip: "",
      phone: "",
      lat: v.lat,
      lng: v.lng,
      distance: 0,
      legacyCode: "",
      primo: "",
      source: v.source as DataSource,
      urls: {
        store: "",
        interchange: "",
        inventory: "",
        prices: v.pricesUrl ?? "",
        directions: "",
        sellACar: "",
        contact: "",
        customerServiceChat: null,
        carbuyChat: null,
        deals: "",
        parts: v.partsUrl ?? "",
      },
    },
    yardLocation: {
      section: v.section ?? "",
      row: v.row ?? "",
      space: v.space ?? "",
    },
    images: v.imageUrl ? [{ url: v.imageUrl }] : [],
    detailsUrl: v.detailsUrl ?? "",
    partsUrl: v.partsUrl ?? "",
    pricesUrl: v.pricesUrl ?? "",
    engine: v.engine ?? undefined,
    trim: v.trim ?? undefined,
    transmission: v.transmission ?? undefined,
  };
}

export const vehiclesRouter = createTRPCRouter({
  /**
   * Get a vehicle by VIN from the canonical vehicle table.
   */
  getById: publicProcedure
    .input(
      z.object({
        vin: z.string(),
      }),
    )
    .query(async ({ input, ctx }): Promise<Vehicle | null> => {
      const [row] = await ctx.db
        .select()
        .from(vehicle)
        .where(eq(vehicle.vin, input.vin))
        .limit(1);

      if (!row) return null;
      return dbVehicleToVehicle(row);
    }),

  getPopularMakes: publicProcedure.query(async (): Promise<string[]> => {
    return [
      "HONDA",
      "TOYOTA",
      "FORD",
      "CHEVROLET",
      "NISSAN",
      "HYUNDAI",
      "KIA",
      "MAZDA",
      "SUBARU",
      "VOLKSWAGEN",
    ];
  }),

  getModelsForMake: publicProcedure
    .input(z.object({ make: z.string() }))
    .query(async ({ input }): Promise<string[]> => {
      const makeModels: Record<string, string[]> = {
        HONDA: ["ACCORD", "CIVIC", "CR-V", "PILOT", "ODYSSEY", "FIT", "HR-V"],
        TOYOTA: [
          "CAMRY",
          "COROLLA",
          "RAV4",
          "PRIUS",
          "HIGHLANDER",
          "SIENNA",
          "TACOMA",
        ],
        FORD: [
          "F-150",
          "ESCAPE",
          "FOCUS",
          "FUSION",
          "EXPLORER",
          "EDGE",
          "MUSTANG",
        ],
        CHEVROLET: [
          "SILVERADO",
          "EQUINOX",
          "MALIBU",
          "CRUZE",
          "TAHOE",
          "SUBURBAN",
          "IMPALA",
        ],
        NISSAN: [
          "ALTIMA",
          "SENTRA",
          "ROGUE",
          "PATHFINDER",
          "FRONTIER",
          "TITAN",
          "VERSA",
        ],
      };
      return makeModels[input.make.toUpperCase()] ?? [];
    }),
});
