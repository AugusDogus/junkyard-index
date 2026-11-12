import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";

const response = z.object({
  url: z.string(),
  raw: z.string(),
  headers: z.record(z.string()),
  sourceSha256: z.string(),
});
export const clearsalvageSaved = z
  .object({
    opening: z.array(response),
    closing: z.array(response),
    donors: z.array(
      z.object({ url: z.string(), raw: z.string(), sourceSha256: z.string() }),
    ),
  })
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL("./fixtures/clearsalvage-census.json.gz", import.meta.url),
        ),
      ).toString("utf8"),
    ),
  );
