import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { z } from "zod";
export const bigdNative = z
  .object({
    opening: z.string(),
    closing: z.string(),
    contact: z.string(),
    closingContact: z.string(),
  })
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL("./bigd-test-fixtures/native.json.gz", import.meta.url),
        ),
      ).toString(),
    ),
  );
