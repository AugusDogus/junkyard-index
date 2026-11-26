import { expect, test } from "bun:test";

test("a yard model page's direct Turso read retries a gateway error", () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
    import { mock } from "bun:test";
    import { LibsqlError } from "@libsql/client/web";
    mock.module("server-only", () => ({}));
    mock.module("next/cache", () => ({
      unstable_cache: (load) => (...args) => load(...args),
    }));
    mock.module("~/lib/db", () => ({ db: {} }));
    let attempts = 0;
    mock.module("~/server/yard-vehicles", () => ({
      YardVehicles: {
        model: async () => {
          attempts++;
          if (attempts === 1) {
            const cause = Object.assign(new Error("Server returned HTTP status 503"), { status: 503 });
            throw new LibsqlError(cause.message, "SERVER_ERROR", undefined, undefined, cause);
          }
          return [];
        },
      },
    }));
    const { YardInventory } = await import("./src/lib/yard-inventory.ts");
    const vehicles = [{
      vin: "VIN1", year: 2004, make: "Chevrolet", model: "Silverado",
      trim: null, engine: null, color: null, stockNumber: null, section: null,
      row: null, space: null, addedAt: 1, addedBy: "first-seen",
      imageUrl: null, detailsUrl: null,
    }];
    const summary = YardInventory.summary(vehicles, ["Chevrolet"]);
    const { getYardModelVehicles } = await import("./src/server/yard-inventory.ts");
    const read = await getYardModelVehicles(
      { source: "pyp", code: "1" },
      summary,
      "CHEVROLET",
      { key: "SILVERADO", rawModels: ["Silverado"] },
    );
    console.log(JSON.stringify({ attempts, vehicles: read.length }));
  `,
    ],
    { cwd: process.cwd(), env: { ...process.env, SKIP_ENV_VALIDATION: "1" } },
  );
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString())).toEqual({
    attempts: 2,
    vehicles: 0,
  });
});
