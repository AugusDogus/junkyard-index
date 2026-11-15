import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { ALLIED_CONTRACT } from "./allied-configuration";
import { parseAlliedModel } from "./allied-parser";
import type { AlliedResult } from "./allied-result";
const documents = z
  .record(z.string(), z.string())
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL("./allied-test-fixtures/sample.json.gz", import.meta.url),
        ),
      ).toString(),
    ),
  );
export function alliedFixture(name: string): string {
  const value = documents[name];
  if (value === undefined) throw new Error("No saved Allied fixture: " + name);
  return value;
}
export function alliedValue<T>(result: AlliedResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
export const alliedFixtureContract = {
  ...ALLIED_CONTRACT,
  minimumUniqueInventory: 1,
};
export const alliedIlx = {
  make: { path: "/parts/ACURA", label: "ACURA", count: 11 },
  model: { path: "/parts/ACURA/ILX/", label: "ILX", count: 1 },
};
export const alliedIlxPage = () =>
  alliedValue(parseAlliedModel(alliedFixture("model-ilx"), alliedIlx));
