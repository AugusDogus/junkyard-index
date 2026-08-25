import { describe, expect, test } from "bun:test";
import { getVercelBuildSteps } from "../../../scripts/vercel-build";

describe("Vercel build policy", () => {
  test.each(["production", "preview"])(
    "migrates before a %s build",
    (environment) => {
      expect(getVercelBuildSteps(environment)).toEqual([
        ["bun", "run", "db:migrate"],
        ["bun", "run", "build"],
      ]);
    },
  );

  test.each(["development", undefined])(
    "does not migrate outside Vercel deployments (%s)",
    (environment) => {
      expect(getVercelBuildSteps(environment)).toEqual([
        ["bun", "run", "build"],
      ]);
    },
  );
});
