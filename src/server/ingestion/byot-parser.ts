import { z } from "zod";
import { ByotResult } from "./byot-result";

const RecordsSchema = z.array(z.unknown()).max(4999);
const SearchSchema = z
  .object({
    search_id: z.number().int().nonnegative().nullable(),
    data: z
      .object({
        availableVehicles: RecordsSchema,
        compatibleVehicles: RecordsSchema,
      })
      .strict(),
  })
  .strict();
/** The native empty search is explicit. Missing arrays, API errors, capped
 * feeds and new pagination controls cannot masquerade as complete inventory.
 * Compatible vehicles are interchange suggestions, never yard presence. */
export function parseByotResponse(
  raw: string,
  kind: "arrivals" | "search",
  context = "native",
) {
  return ByotResult.boundary(`${context} ${kind} response`, () => {
    const input: unknown = JSON.parse(raw);
    return kind === "arrivals"
      ? RecordsSchema.parse(input)
      : SearchSchema.parse(input).data.availableVehicles;
  });
}
