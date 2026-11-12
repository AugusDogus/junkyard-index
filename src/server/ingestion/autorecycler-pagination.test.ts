import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { Effect } from "effect";
import {
  streamAutorecyclerInventoryWithPageFetcher,
  type AutorecyclerStreamResult,
} from "./autorecycler-connector";
import { Database } from "./context";
import { AutorecyclerCursor } from "./autorecycler-cursor";
import { buildInventoryMsearchBody } from "./autorecycler-client";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-source";

function recordId(index: number) {
  return `${1_700_000_000_000 - index}x100000000000000000`;
}

describe("AutoRecycler complete feed traversal", () => {
  test("keeps visibility and deletion filters while querying each record-ID range from offset zero", () => {
    for (const beforeId of [null, recordId(50_000)]) {
      const request = buildInventoryMsearchBody(beforeId, 400);
      expect(request.searches).toHaveLength(1);
      expect(request.searches[0]).toMatchObject({
        from: 0,
        n: 400,
        type: "custom.inventorysearch",
        sorts_list: [{ sort_field: "_id", descending: true }],
        constraints: [
          { key: "deleted_boolean", value: true, constraint_type: "not equal" },
          { key: "visible_boolean", value: true, constraint_type: "equals" },
          ...(beforeId === null
            ? []
            : [{ key: "_id", value: beforeId, constraint_type: "less than" }]),
        ],
      });
    }
  });

  test("resumes serialized chunk checkpoints without skipping records and fetches nothing after completion", async () => {
    const client = createClient({ url: ":memory:" });
    const requests: Array<string | null> = [];
    let cursor: AutorecyclerCursor = AutorecyclerCursor.initial;
    let total = 0;
    const records = Array.from({ length: 805 }, (_, index) => ({
      _id: recordId(index),
      _source: {},
    }));
    try {
      for (let chunk = 0; chunk < 5; chunk++) {
        const result: AutorecyclerStreamResult = await Effect.runPromise(
          streamAutorecyclerInventoryWithPageFetcher(
            { startCursor: cursor, maxPages: 1, onBatch: () => Effect.void },
            async (beforeId, size) => {
              requests.push(beforeId);
              return {
                responses: [
                  {
                    hits: {
                      hits: records
                        .filter(
                          (record) =>
                            beforeId === null || record._id < beforeId,
                        )
                        .slice(0, size),
                    },
                    at_end: true,
                  },
                ],
              };
            },
          ).pipe(Effect.provideService(Database, drizzle(client))),
        );
        total += result.accounting?.recordsProcessed ?? 0;
        cursor = parseDurableSourceCursor(
          "autorecycler",
          serializeDurableSourceCursor(result.cursor),
        );
        expect(result.status).toBe(chunk < 3 ? "paused" : "complete");
      }
      expect(total).toBe(805);
      expect(requests).toEqual([
        null,
        recordId(399),
        recordId(799),
        recordId(804),
      ]);
    } finally {
      client.close();
    }
  });

  test("visits more than 50000 records, including one large organization and organization-less rows", async () => {
    const client = createClient({ url: ":memory:" });
    const total = 50_805;
    const requests: unknown[] = [];
    const organization =
      "1348695171700984260__LOOKUP__1761169592468x394558876247902400";
    const independentOrganization =
      "1348695171700984260__LOOKUP__1726602417880x199387504054651780";
    const emittedVins: string[] = [];
    try {
      await client.executeMultiple(
        "create table autorecycler_org_geo (org_lookup text primary key, lat real not null, lng real not null, location_name text not null, location_city text not null, state text not null, state_abbr text not null, address text, updated_at integer not null, resolution_version integer not null)",
      );
      await client.execute({
        sql: "insert into autorecycler_org_geo values (?, 32.44, -84.94, 'Columbus', 'Columbus', 'Georgia', 'GA', null, 1, 1)",
        args: [independentOrganization],
      });
      const result = await Effect.runPromise(
        streamAutorecyclerInventoryWithPageFetcher(
          {
            maxPages: 200,
            onBatch: (batch) =>
              Effect.sync(() => {
                emittedVins.push(...batch.map((vehicle) => vehicle.vin));
              }),
          },
          async (beforeId, size) => {
            requests.push(beforeId);
            const after =
              typeof beforeId === "string"
                ? 1_700_000_000_000 - Number(beforeId.split("x")[0])
                : -1;
            const hits = Array.from(
              { length: Math.min(size, total - after - 1) },
              (_, offset) => {
                const index = after + offset + 1;
                return {
                  _id: recordId(index),
                  _source:
                    index < 50_001
                      ? {
                          organization_custom_organization: organization,
                          vin_text: "KNADE123666155428",
                        }
                      : index === total - 1
                        ? {
                            organization_custom_organization:
                              independentOrganization,
                            inventory_id_text:
                              "1787737161109x728407258643232400",
                            vin_text: "KNADE123666155428",
                            name_text: "2006 Kia Rio",
                          }
                        : {},
                };
              },
            );
            return {
              responses: [{ at_end: hits.length < size, hits: { hits } }],
            };
          },
          (orgs) =>
            Effect.succeed(
              new Map(
                orgs.map(
                  (org) =>
                    [
                      org,
                      org === organization ? "direct-provider" : "independent",
                    ] as const,
                ),
              ),
            ),
        ).pipe(Effect.provideService(Database, drizzle(client))),
      );
      expect(result.status).toBe("complete");
      expect(result.accounting).toMatchObject({
        recordsProcessed: total,
        recordsExcluded: 50_001,
        recordsRejected: 803,
      });
      expect(result.count).toBe(1);
      expect(emittedVins).toEqual(["KNADE123666155428"]);
      expect(result.observedVins).toEqual([]);
      expect(requests[0]).toBeNull();
      expect(requests.at(-1)).toBe(recordId(total - 1));
    } finally {
      client.close();
    }
  });

  test.each(["repeated", "reversed", "missing", "boundary"])(
    "fails before emitting a page with %s record IDs",
    async (kind) => {
      const client = createClient({ url: ":memory:" });
      let emitted = 0;
      let policies = 0;
      try {
        const hits =
          kind === "boundary"
            ? [{ _id: recordId(1), _source: {} }]
            : kind === "missing"
              ? [{ _source: {} }]
              : [recordId(1), recordId(kind === "repeated" ? 1 : 0)].map(
                  (_id) => ({ _id, _source: {} }),
                );
        const result = await Effect.runPromise(
          streamAutorecyclerInventoryWithPageFetcher(
            {
              startCursor:
                kind === "boundary"
                  ? {
                      source: "autorecycler",
                      phase: "page",
                      beforeId: recordId(1),
                    }
                  : AutorecyclerCursor.initial,
              maxPages: 1,
              onBatch: () =>
                Effect.sync(() => {
                  emitted++;
                }),
            },
            async () => ({ responses: [{ at_end: true, hits: { hits } }] }),
            () =>
              Effect.sync(() => {
                policies++;
                return new Map<string, "independent">();
              }),
          ).pipe(
            Effect.provideService(Database, drizzle(client)),
            Effect.either,
          ),
        );
        expect(result._tag).toBe("Left");
        if (result._tag === "Right")
          throw new Error("Unsafe pagination was accepted");
        expect(result.left.message).toContain("inventory is preserved");
        expect(emitted).toBe(0);
        expect(policies).toBe(0);
      } finally {
        client.close();
      }
    },
  );

  test("does not accept at_end on a nonempty page as proof that all records were fetched", async () => {
    const client = createClient({ url: ":memory:" });
    const requests: unknown[] = [];
    try {
      const result = await Effect.runPromise(
        streamAutorecyclerInventoryWithPageFetcher(
          { maxPages: 4, onBatch: () => Effect.void },
          async (beforeId) => {
            requests.push(beforeId);
            return {
              responses: [
                {
                  at_end: true,
                  hits: {
                    hits:
                      requests.length <= 2
                        ? [{ _id: recordId(requests.length), _source: {} }]
                        : [],
                  },
                },
              ],
            };
          },
        ).pipe(Effect.provideService(Database, drizzle(client))),
      );
      expect(result.status).toBe("complete");
      expect(result.accounting?.recordsProcessed).toBe(2);
      expect(requests).toEqual([null, recordId(1), recordId(2)]);
    } finally {
      client.close();
    }
  });

  test.each([
    {},
    { responses: [] },
    { responses: [{ hits: {} }] },
    { responses: [{ error: "provider error", hits: { hits: [] } }] },
    { error: "provider error", responses: [{ hits: { hits: [] } }] },
  ])(
    "rejects malformed or failed responses instead of treating them as an empty terminal query (%j)",
    async (response) => {
      const client = createClient({ url: ":memory:" });
      try {
        const result = await Effect.runPromise(
          streamAutorecyclerInventoryWithPageFetcher(
            { onBatch: () => Effect.void },
            async () => response,
          ).pipe(
            Effect.provideService(Database, drizzle(client)),
            Effect.either,
          ),
        );
        expect(result._tag).toBe("Left");
        if (result._tag === "Right")
          throw new Error("Failed response was accepted as complete");
        expect(result.left.message).toContain("inventory is preserved");
      } finally {
        client.close();
      }
    },
  );
});
