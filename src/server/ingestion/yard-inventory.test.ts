import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { RECONCILIATION_TEST_SCHEMA } from "./durable-reconciliation-test-fixtures";
import {
  yardInventoryRefreshStatements,
  yardPublicationStatement,
} from "./yard-inventory";

test("yard publications advance only accepted yards and survive summary refreshes", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
    for (const [vin, source, code] of [
      ["A", "autorecycler", "fresh"],
      ["B", "autorecycler", "preserved"],
      ["C", "pyp", "failed"],
    ]) {
      if (!vin || !source || !code) throw new Error("Missing fixture identity");
      await client.execute({
        sql: `insert into vehicle (vin, source, year, make, model, location_code, location_name, location_city, state, state_abbr, lat, lng, first_seen_at, last_seen_at)
        values (?, ?, 2000, 'Honda', 'Civic', ?, 'Yard', 'City', 'California', 'CA', 34, -118, 1, 1)`,
        args: [vin, source, code],
      });
    }
    const sources = ["autorecycler", "pyp"];
    await client.batch(yardInventoryRefreshStatements(sources, 100), "write");
    // Existing summaries cannot establish a trustworthy publication date.
    expect(
      (
        await client.execute("select last_published_at from yard_inventory")
      ).rows.every((row) => row.last_published_at === null),
    ).toBe(true);
    // The first post-deploy publication fills only accepted, non-preserved
    // yards. A failed source and a preserved yard remain honestly unknown.
    const partial = yardPublicationStatement(
      ["autorecycler"],
      new Map([["autorecycler", new Set(["preserved"])]]),
      100,
    );
    if (!partial) throw new Error("Expected partial publication statement");
    await client.execute(partial);
    expect(
      (
        await client.execute(
          "select location_code, last_published_at from yard_inventory order by location_code",
        )
      ).rows.map((row) => ({
        location_code: row.location_code,
        last_published_at: row.last_published_at,
      })),
    ).toEqual([
      { location_code: "failed", last_published_at: null },
      { location_code: "fresh", last_published_at: 100 },
      { location_code: "preserved", last_published_at: null },
    ]);
    // Each unknown yard gets its date when it is eventually accepted.
    const first = yardPublicationStatement(sources, new Map(), 100);
    if (!first) throw new Error("Expected publication statement");
    await client.execute(first);
    await client.batch(yardInventoryRefreshStatements(sources, 200), "write");
    const publication = yardPublicationStatement(
      ["autorecycler"],
      new Map([["autorecycler", new Set(["preserved"])]]),
      200,
    );
    if (!publication) throw new Error("Expected publication statement");
    await client.execute(publication);
    expect(
      (
        await client.execute(
          "select location_code, last_published_at from yard_inventory order by location_code",
        )
      ).rows.map((row) => ({
        location_code: row.location_code,
        last_published_at: row.last_published_at,
      })),
    ).toEqual([
      { location_code: "failed", last_published_at: 100 },
      { location_code: "fresh", last_published_at: 200 },
      { location_code: "preserved", last_published_at: 100 },
    ]);
    await client.batch(yardInventoryRefreshStatements(sources, 300), "write");
    expect(
      (
        await client.execute(
          "select last_published_at from yard_inventory where location_code = 'preserved'",
        )
      ).rows[0]?.last_published_at,
    ).toBe(100);
    expect(yardPublicationStatement([], new Map(), 400)).toBeNull();
  } finally {
    client.close();
  }
});
