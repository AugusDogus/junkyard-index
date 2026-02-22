import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Vehicle } from "~/lib/types";
import { dbVehicleToVehicle } from "~/lib/vehicle-utils";
import { vehicle } from "~/schema";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

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
