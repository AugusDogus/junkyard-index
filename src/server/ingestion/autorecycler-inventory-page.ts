import { z } from "zod";
import { AutorecyclerRecordIdSchema } from "./autorecycler-cursor";

export const AUTORECYCLER_PAGE_SIZE = 400;

const responseSchema = z.object({
  error: z.never().optional(),
  errors: z.never().optional(),
  responses: z
    .array(
      z.object({
        error: z.never().optional(),
        errors: z.never().optional(),
        hits: z.object({
          hits: z
            .array(
              z.object({
                _id: AutorecyclerRecordIdSchema,
                _source: z.record(z.unknown()).optional(),
              }),
            )
            .max(AUTORECYCLER_PAGE_SIZE),
        }),
      }),
    )
    .length(1),
});

type InventoryHit = z.infer<
  typeof responseSchema
>["responses"][number]["hits"]["hits"][number];

export type AutorecyclerInventoryPage =
  | { ok: true; hits: InventoryHit[]; lastId: string | null }
  | { ok: false; detail: string };

export const AutorecyclerInventoryPage = {
  /** Verify the provider honored the unique-ID ordering and strict upper bound. */
  parse(value: unknown, beforeId: string | null): AutorecyclerInventoryPage {
    const parsed = responseSchema.safeParse(value);
    if (!parsed.success)
      return {
        ok: false,
        detail: `Malformed inventory search response: ${parsed.error.message}`,
      };
    const response = parsed.data.responses[0];
    if (!response)
      return { ok: false, detail: "Inventory search response is missing" };
    let previous = beforeId;
    for (const hit of response.hits.hits) {
      if (previous !== null && hit._id >= previous)
        return {
          ok: false,
          detail: `Inventory search returned record ${hit._id} before ${previous}; expected strictly decreasing record IDs. The provider did not honor the pagination boundary or ordering`,
        };
      previous = hit._id;
    }
    return {
      ok: true,
      hits: response.hits.hits,
      lastId: response.hits.hits.at(-1)?._id ?? null,
    };
  },
} as const;
