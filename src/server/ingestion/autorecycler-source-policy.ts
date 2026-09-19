import { Effect } from "effect";
import { z } from "zod";
import {
  buildMgetBody,
  postAutorecyclerElasticsearchMget,
} from "./autorecycler-client";
import { AutorecyclerProviderError } from "./errors";

// Verified operator identity, not a yard-name heuristic. The direct pullapart
// connector owns availability for this organization's Pull-A-Part/U-Pull-&-Pay yards.
const PULLAPART_ORGANIZATION = "1761169592468x394558876247902400";
const reference = z
  .string()
  .trim()
  .regex(/^(?:\d+__LOOKUP__)?\d+x\d+$/)
  .transform((value) => value.replace(/^\d+__LOOKUP__/, ""));
const responseSchema = z.object({
  error: z.never().optional(),
  errors: z.never().optional(),
  docs: z.array(
    z.discriminatedUnion("found", [
      z.object({
        _id: reference,
        found: z.literal(false),
        _type: z.literal("custom.organization").optional(),
        error: z.never().optional(),
        errors: z.never().optional(),
        _source: z.never().optional(),
      }),
      z.object({
        _id: reference,
        found: z.literal(true),
        _type: z.literal("custom.organization"),
        error: z.never().optional(),
        errors: z.never().optional(),
        _source: z.object({
          _id: reference.optional(),
          _type: z.literal("custom.organization").optional(),
          parent_organization_custom_organization: reference.nullish(),
        }),
      }),
    ]),
  ),
});

export type AutorecyclerSourceDecision =
  | "independent"
  | "direct-provider"
  | "unresolved";
export type AutorecyclerSourcePolicy = (
  organizations: readonly string[],
) => Effect.Effect<
  ReadonlyMap<string, AutorecyclerSourceDecision>,
  AutorecyclerProviderError
>;

export const AutorecyclerSourcePolicy = {
  create(
    fetchRecords: (ids: string[]) => Promise<unknown> = (ids) =>
      postAutorecyclerElasticsearchMget(buildMgetBody(ids)),
  ): AutorecyclerSourcePolicy {
    const cache = new Map<string, AutorecyclerSourceDecision>();
    return (organizations) =>
      Effect.tryPromise({
        try: async () => {
          const lookups = new Map(
            organizations.map((org) => [org, reference.parse(org)]),
          );
          const missing = new Set(
            [...lookups.values()].filter((id) => !cache.has(id)),
          );
          if (missing.size > 0) {
            const response = responseSchema.parse(
              await fetchRecords([...missing]),
            );
            const decisions = new Map<string, AutorecyclerSourceDecision>();
            for (const doc of response.docs) {
              if (
                !missing.has(doc._id) ||
                decisions.has(doc._id) ||
                (doc.found &&
                  doc._source._id !== undefined &&
                  doc._source._id !== doc._id)
              ) {
                throw new Error(
                  `Unexpected, duplicate, or contradictory organization record ${doc._id}`,
                );
              }
              decisions.set(
                doc._id,
                doc._id === PULLAPART_ORGANIZATION ||
                  (doc.found &&
                    doc._source.parent_organization_custom_organization ===
                      PULLAPART_ORGANIZATION)
                  ? "direct-provider"
                  : doc.found
                    ? "independent"
                    : "unresolved",
              );
            }
            if (decisions.size !== missing.size)
              throw new Error(
                `Incomplete organization response: received ${decisions.size} of ${missing.size} records`,
              );
            for (const [id, decision] of decisions) cache.set(id, decision);
          }
          const result = new Map<string, AutorecyclerSourceDecision>();
          for (const [org, id] of lookups) {
            const decision = cache.get(id);
            if (!decision)
              throw new Error(`Organization ${org} was not classified`);
            result.set(org, decision);
          }
          return result;
        },
        catch: (cause) =>
          new AutorecyclerProviderError({
            from: -1,
            cause: new Error(
              `AutoRecycler source ownership lookup failed: ${cause instanceof Error ? cause.message : String(cause)}. No inventory was emitted for this page; inspect the organization response before retrying.`,
              { cause },
            ),
          }),
      });
  },
} as const;
