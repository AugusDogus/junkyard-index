import { z } from "zod";

export const PontiacYearSchema = z.number().int().min(1886).max(2100);
// Keep native whitespace and spelling in request parameters. Some directory
// makes have trailing spaces; normalization belongs to display fields only.
export const PontiacNameSchema = z
  .string()
  .min(1)
  .max(150)
  .refine((s) => s.trim().length > 0);
export const PontiacPairSchema = z
  .object({ year: PontiacYearSchema, make: PontiacNameSchema })
  .strict();
export const PontiacModelSchema = z.object({
  hollanderModel: PontiacNameSchema,
  trueModel: z.string().max(150).nullable(),
  mmdCD: z.string().max(150),
  mmdCategory: z.string().max(150),
});
export const PontiacMappingSchema = PontiacPairSchema.extend(
  PontiacModelSchema.shape,
).strict();
export const PontiacQuerySchema = PontiacPairSchema.extend({
  model: PontiacNameSchema,
}).strict();
export type PontiacMapping = z.infer<typeof PontiacMappingSchema>;
export type PontiacQuery = z.infer<typeof PontiacQuerySchema>;

export function pontiacMappingKey(m: PontiacMapping): string {
  return JSON.stringify([
    m.make,
    m.hollanderModel,
    m.trueModel,
    m.mmdCD,
    m.mmdCategory,
  ]);
}

export function mergePontiacMappings(
  previous: PontiacMapping[],
  incoming: PontiacMapping[],
): PontiacMapping[] {
  const merged = new Map(previous.map((m) => [pontiacMappingKey(m), m]));
  for (const mapping of incoming) {
    const key = pontiacMappingKey(mapping);
    const existing = merged.get(key);
    if (!existing || existing.year < mapping.year) merged.set(key, mapping);
  }
  return [...merged.values()];
}

export function pontiacSearchPath(query: PontiacQuery): string {
  return (
    "/api/vehicles/search/?" +
    new URLSearchParams({
      store: "105",
      year: String(query.year),
      make: query.make,
      model: query.model,
    })
  );
}

export function pontiacQueries(mappings: PontiacMapping[]): PontiacQuery[] {
  const queries = mappings.map((m) => ({
    year: m.year,
    make: m.make,
    model: m.hollanderModel,
  }));
  return [...new Map(queries.map((q) => [pontiacSearchPath(q), q])).values()];
}
