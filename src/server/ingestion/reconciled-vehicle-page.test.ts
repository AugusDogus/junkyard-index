import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { reconciledVehiclePage } from "./reconciled-vehicle-page";

const SCHEMA = `
  create table vehicle (
    vin text primary key, source text not null, location_code text not null,
    missing_since_at integer, missing_run_count integer
  );
  create index vehicle_source_vin_idx on vehicle(source, vin);
`;

async function databaseWith(rows: { vin: string; source: string }[]) {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(SCHEMA);
  for (const row of rows) {
    await client.execute({
      sql: "insert into vehicle (vin, source, location_code) values (?, ?, 'yard-1')",
      args: [row.vin, row.source],
    });
  }
  const queries: { sql: string; params: unknown[] }[] = [];
  const database = drizzle(client, {
    logger: { logQuery: (sql, params) => queries.push({ sql, params }) },
  });
  return { client, database, queries };
}

const ROWS = [
  { vin: "A1", source: "pyp" },
  { vin: "B1", source: "retired" },
  { vin: "C1", source: "pyp" },
  { vin: "D1", source: "other" },
  { vin: "E1", source: "retired" },
  { vin: "F1", source: "pyp" },
];

describe("reconciledVehiclePage", () => {
  test("returns the sources' rows after the cursor in VIN order, up to the limit", async () => {
    const { database } = await databaseWith(ROWS);
    const page = await reconciledVehiclePage(
      database,
      ["pyp", "retired"],
      "A1",
      3,
    );
    expect(page.map((row) => [row.vin, row.source])).toEqual([
      ["B1", "retired"],
      ["C1", "pyp"],
      ["E1", "retired"],
    ]);
  });

  test("starts at the first VIN without a cursor", async () => {
    const { database } = await databaseWith(ROWS);
    const page = await reconciledVehiclePage(database, ["pyp"], null, 10);
    expect(page.map((row) => row.vin)).toEqual(["A1", "C1", "F1"]);
  });

  test("reads each source in index order, so the limit stops the read", async () => {
    const { client, database, queries } = await databaseWith(ROWS);
    await reconciledVehiclePage(database, ["pyp", "retired"], "A1", 3);
    expect(queries.length).toBe(2);
    for (const query of queries) {
      const plan = await client.execute({
        sql: `explain query plan ${query.sql}`,
        args: query.params.map((param) =>
          typeof param === "number" || typeof param === "string" ? param : null,
        ),
      });
      const details = plan.rows.map((row) => String(row.detail));
      expect(details.join("\n")).toContain(
        "USING INDEX vehicle_source_vin_idx (source=? AND vin>?)",
      );
      expect(details.join("\n")).not.toContain("TEMP B-TREE");
    }
  });
});
