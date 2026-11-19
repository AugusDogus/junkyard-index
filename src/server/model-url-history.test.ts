import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import { inventorySnapshot, vehicleModelRedirect } from "~/schema";
import { retainModelUrls } from "./model-url-history";
import { rememberModelRedirects } from "./ingestion/vin-canonicalization";
import { makeVehicle } from "./ingestion/durable-ingestion-test-fixtures";
import { InventorySnapshot } from "./inventory-snapshot";
import { ModelRedirect } from "~/lib/model-redirect";
import { permanentRedirect } from "next/navigation";

test("captures preferred URLs in every retained snapshot before changes, so indexed pages cannot disappear", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(
      "create table vehicle (vin text primary key);" +
        readFileSync(
          new URL(
            "../../drizzle/0026_vin_canonical_models.sql",
            import.meta.url,
          ),
          "utf8",
        ) +
        readFileSync(
          new URL("../../drizzle/0020_inventory_snapshot.sql", import.meta.url),
          "utf8",
        ),
    );
    const database = drizzle(client);
    for (const version of ["v2", "v3"])
      await database.insert(inventorySnapshot).values([
        {
          key: `${version}:make-counts`,
          data: JSON.stringify([{ make: "Ford", count: 100 }]),
          updatedAt: new Date(),
        },
        {
          key: `${version}:make-models:FORD`,
          data: JSON.stringify([
            [
              "pyp",
              "1",
              "Ford",
              version === "v2" ? "F150NEW" : "TRUCK F150",
              100,
              1990,
              2015,
            ],
          ]),
          updatedAt: new Date(),
        },
      ]);
    expect(await retainModelUrls(database)).toBe(3);
    const old = await database.select().from(vehicleModelRedirect);
    expect(old.map((row) => row.fromPath).sort()).toEqual([
      "/cars/ford",
      "/cars/ford/f150new",
      "/cars/ford/truck-f150",
    ]);
    await rememberModelRedirects(database, [
      {
        ...makeVehicle("old"),
        make: "Ford",
        model: "F-150",
        sourceMake: "Ford",
        sourceModel: "F150NEW",
      },
    ]);
    const redirects = await database.select().from(vehicleModelRedirect);
    expect(
      redirects.find((row) => row.fromPath.endsWith("f150new"))?.toPath,
    ).toBe("/cars/ford/f-150");
    expect(await InventorySnapshot.modelUrls(database)).toEqual([
      "/cars/ford",
      "/cars/ford/truck-f150",
    ]);
    for (const row of redirects) {
      const to = ModelRedirect.destination(
        row.toPath || ModelRedirect.parent(row.fromPath),
        {
          make: { href: "/cars/ford", name: "Ford" },
          models: [{ key: "F150", slug: "f-150", href: "/cars/ford/f-150" }],
        },
      );
      try {
        permanentRedirect(to);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        if (error instanceof Error && "digest" in error)
          expect(String(error.digest)).toContain(";308;");
        else throw error;
      }
    }
  } finally {
    client.close();
  }
});
