import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

export function hagermanFixture(name: string): string {
  return gunzipSync(
    readFileSync(
      new URL(`./fixtures/hagerman-${name}.html.gz`, import.meta.url),
    ),
  ).toString("utf8");
}
