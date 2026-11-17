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
// One-time October 2024 LKQ imports. The pyp source reads these yards live.
const DIRECT_PROVIDER_ORGANIZATIONS = new Set([
  PULLAPART_ORGANIZATION,
  "1729734766990x950099823086187300", // LKQ - CHATTANOOGA
  "1729734766093x340198914988167880", // LKQ - NASHVILLE
  "1729734766535x427413633759663500", // LKQ - CHARLOTTE
  "1729734765104x535405133894433660", // LKQ - SAVANNAH
  "1729734768283x592117435094416500", // LKQ - MEMPHIS
  "1729734764662x232536945531569570", // LKQ - GREER
  "1729734764195x109900838604892300", // LKQ - DURHAM
  "1729734763657x870281075279977200", // LKQ - GREENSBORO
  "1729734765576x140464582636548050", // LKQ - FAYETTEVILLE
  "1729734763257x684941304085489500", // Pick Your Part - Greenville
  "1729734767394x763899678894703500", // LKQ - EAST NC
  "1729734767860x176607785988997630", // LKQ - CHARLESTON
  // Former AutoRecycler customers now read directly: Paul's Auto Yard via
  // hollanderstores, Ryan's Pick-A-Part via vinplus. Their legacy feeds froze
  // when they left; never let a revived copy duplicate the direct yards.
  "1761071937027x514174316460297860", // Paul's - South Bend
  "1761071936874x713046217845783900", // Paul's - Fort Wayne
  "1761071937073x771631222664628200", // Paul's - Westville
  "1761071936989x914699093015752600", // Paul's - Merrillville
  "1761069152080x996853889979226500", // Paul's - Lake Station
  "1761071936914x994987077933516800", // Paul's - Elkhart North
  "1761071936799x270770136291979650", // Paul's - DeMotte
  "1761071936758x445900678572385340", // Paul's - Knox
  "1761071936952x676404213301774700", // Paul's - Logansport
  "1757515768480x772759259987457800", // Ryan's Pick-A-Part - Detroit
]);
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
  | "stale"
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
                DIRECT_PROVIDER_ORGANIZATIONS.has(doc._id) ||
                  (doc.found &&
                    DIRECT_PROVIDER_ORGANIZATIONS.has(
                      doc._source.parent_organization_custom_organization ?? "",
                    ))
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
