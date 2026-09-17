import { z } from "zod";
import {
  buildMgetBody,
  postAutorecyclerElasticsearchMget,
} from "./autorecycler-client";

const recordReference = z.string().regex(/^(?:\d+__LOOKUP__)?\d+x\d+$/);
const recordSource = z.object({
  website_custom_website: recordReference.nullish(),
  Slug: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .nullish(),
});
const responseSchema = z.object({
  error: z.never().optional(),
  errors: z.never().optional(),
  docs: z.array(
    z.discriminatedUnion("found", [
      z.object({
        _id: recordReference,
        found: z.literal(false),
        error: z.never().optional(),
        errors: z.never().optional(),
      }),
      z.object({
        _id: recordReference,
        found: z.literal(true),
        _type: z.enum(["custom.organization", "custom.website"]),
        _source: recordSource,
        error: z.never().optional(),
        errors: z.never().optional(),
      }),
    ]),
  ),
});

function recordId(reference: string): string {
  return recordReference.parse(reference).replace(/^\d+__LOOKUP__/, "");
}

/** Resolve explicit organization → website references, never names or parent-yard geography. */
export async function fetchAutorecyclerYardWebsites(
  orgLookups: readonly string[],
  fetchRecords: (ids: string[]) => Promise<unknown> = (ids) =>
    postAutorecyclerElasticsearchMget(buildMgetBody(ids)),
): Promise<Map<string, string | null>> {
  async function records(
    ids: string[],
    type: "custom.organization" | "custom.website",
  ) {
    if (ids.length === 0)
      return new Map<string, z.infer<typeof recordSource> | null>();
    const response = responseSchema.parse(await fetchRecords(ids));
    const result = new Map<string, z.infer<typeof recordSource> | null>();
    for (const doc of response.docs) {
      const id = recordId(doc._id);
      if (
        !ids.includes(id) ||
        result.has(id) ||
        (doc.found && doc._type !== type)
      ) {
        throw new Error(
          `AutoRecycler website lookup returned an unexpected, duplicate, or wrong-type record ${doc._id}; expected ${type}. Retry after checking the provider response. Stored links have not been replaced.`,
        );
      }
      result.set(id, doc.found ? doc._source : null);
    }
    if (result.size !== ids.length)
      throw new Error(
        `AutoRecycler website lookup returned ${result.size} of ${ids.length} ${type} records. Retry the incomplete lookup; stored links have not been replaced.`,
      );
    return result;
  }

  const orgIds = new Map(
    orgLookups.map((lookup) => [lookup, recordId(lookup)]),
  );
  const organizations = await records(
    [...new Set(orgIds.values())],
    "custom.organization",
  );
  const websiteIds = [
    ...new Set(
      [...organizations.values()].flatMap((org) =>
        org?.website_custom_website
          ? [recordId(org.website_custom_website)]
          : [],
      ),
    ),
  ];
  const websites = await records(websiteIds, "custom.website");
  return new Map(
    [...orgIds].map(([lookup, id]) => {
      const reference = organizations.get(id)?.website_custom_website;
      const websiteId = reference ? recordId(reference) : null;
      const website = websiteId ? websites.get(websiteId) : null;
      return [
        lookup,
        website
          ? `https://app.autorecycler.io/inventory/${website.Slug ?? websiteId}`
          : null,
      ];
    }),
  );
}
