import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { VehicleName } from "~/lib/vehicle-name";
import { YardVehicles } from "./yard-vehicles";

test("a yard's model list holds only that model's live vehicles there, newest first", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    // The columns yard pages read, as in schema.ts.
    await client.executeMultiple(`
      create table vehicle (
        vin text primary key, source text not null, location_code text not null,
        year integer not null, make text not null, model text not null,
        source_model text, trim text, engine text, color text, stock_number text,
        section text, row text, space text, available_date text,
        first_seen_at integer not null, observed_arrival_at integer,
        image_url text, details_url text, missing_since_at integer
      );
      insert into vehicle (vin, source, location_code, year, make, model, first_seen_at, missing_since_at) values
        ('OLD', 'pyp', '1', 2004, 'Chevrolet', 'Silverado', 1, null),
        ('NEW', 'pyp', '1', 2004, 'CHEVROLET', 'SILVERADO', 3, null),
        ('TAHOE', 'pyp', '1', 2004, 'Chevrolet', 'Tahoe', 2, null),
        ('GONE', 'pyp', '1', 2004, 'Chevrolet', 'Silverado', 4, 4),
        ('ELSEWHERE', 'pyp', '2', 2004, 'Chevrolet', 'Silverado', 5, null);
    `);
    const makeKey = VehicleName.makeKey("Chevrolet");
    const modelKey = VehicleName.modelKey("Chevrolet", "Silverado");
    if (!makeKey || !modelKey)
      throw new Error("Chevrolet Silverado has no key");

    const vehicles = await YardVehicles.model(
      drizzle(client),
      "pyp",
      "1",
      { key: makeKey, spellings: ["CHEVROLET", "Chevrolet"] },
      {
        key: modelKey,
        rawModels: ["SILVERADO", "Silverado"],
      },
    );

    expect(vehicles.map((entry) => entry.vin)).toEqual(["NEW", "OLD"]);
  } finally {
    client.close();
  }
});
