import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
function fixture(name: string): unknown {
  return JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(`./vinplus-test-fixtures/${name}.json.gz`, import.meta.url),
      ),
    ).toString("utf8"),
  );
}
export function vinplusCensus(): string[][] {
  return z.array(z.array(z.string())).parse(fixture("census"));
}
export const vinplusQualification = (): unknown => fixture("qualification");
