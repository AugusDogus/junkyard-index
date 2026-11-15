import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";

// Every closing body is its actual separately dated native capture. Test
// mutations below are synthetic cases, never live qualification evidence.
export const lonestarimportsNative = z
  .object({
    openingDocuments: z.array(z.string()).length(4),
    closingDocuments: z.array(z.string()).length(4),
    openingPages: z.array(z.string()).length(128),
    closingPages: z.array(z.string()).length(128),
  })
  .strict()
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL(
            "./lonestarimports-test-fixtures/native.json.gz",
            import.meta.url,
          ),
        ),
      ).toString("utf8"),
    ),
  );
