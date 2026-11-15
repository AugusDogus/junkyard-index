import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";

const response = z.object({ url: z.string(), html: z.string() }).strict();
export const kandrFixture = z
  .object({
    controls: response,
    opening: z.array(response),
    details: z.array(response),
    closing: z.array(response),
  })
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL("./kandr-test-fixtures/native.json.gz", import.meta.url),
        ),
      ).toString(),
    ),
  );
