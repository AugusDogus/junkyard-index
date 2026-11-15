import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";

// Original public response bodies, captured serially on 2026-11-15. No test
// makes live requests. Receipts record the completed inter-request gaps.
const saved = z
  .record(z.string(), z.string())
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL("./cstruck-test-fixtures/native.json.gz", import.meta.url),
        ),
      ).toString(),
    ),
  );
export function cstruckFixture(key: string): string {
  const value = saved[key];
  if (value === undefined) throw new Error("Missing saved C&S response " + key);
  return value;
}
