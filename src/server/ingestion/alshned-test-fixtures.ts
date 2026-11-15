import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { AlshnedCursor } from "./alshned-cursor";

const captures = z
  .record(z.string(), z.object({ body: z.string() }))
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL("./alshned-test-fixtures/native.json.gz", import.meta.url),
        ),
      ).toString(),
    ),
  );
/** Actual complete native response bodies, captured November 15, 2026 UTC. */
export function alshnedFixture(name: string): string {
  const capture = captures["alshned-" + name];
  if (!capture) throw new Error("Missing Alshned actual capture: " + name);
  return capture.body;
}

import { AlshnedPageSchema, AlshnedDonorSchema } from "./alshned-parser";
/** Parsed by the production parser from all 43 actual saved detail bodies. */
export function alshnedOpeningFixture() {
  return z
    .object({
      pages: z.array(AlshnedPageSchema),
      donors: z.array(AlshnedDonorSchema),
    })
    .strict()
    .parse(
      JSON.parse(
        gunzipSync(
          readFileSync(
            new URL("./alshned-test-fixtures/opening.json.gz", import.meta.url),
          ),
        ).toString(),
      ),
    );
}

/** Terminal checkpoint saved by the full 48-body production-client replay. */
export function alshnedCompleteFixture(): AlshnedCursor {
  return AlshnedCursor.parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL(
            "./alshned-test-fixtures/complete-cursor.json.gz",
            import.meta.url,
          ),
        ),
      ).toString(),
    ),
  );
}
