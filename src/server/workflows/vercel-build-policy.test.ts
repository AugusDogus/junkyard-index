import { describe, expect, test } from "bun:test";
import { getVercelBuildSteps } from "../../../scripts/vercel-build";

describe("Vercel build policy", () => {
  test("migrates before a production build", () => {
    expect(getVercelBuildSteps("production")).toEqual([
      ["bun", "run", "db:migrate"],
      ["bun", "run", "build"],
    ]);
  });

  test.each(["preview", "development", undefined])(
    "does not migrate a non-production build (%s)",
    (environment) => {
      expect(getVercelBuildSteps(environment)).toEqual([
        ["bun", "run", "build"],
      ]);
    },
  );
});
