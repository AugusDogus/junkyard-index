import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  OemgarageCatalogSchema,
  OemgarageRecordSchema,
} from "./oemgarage-parser";

const captures = z
  .record(
    z.string(),
    z.object({
      url: z.string(),
      status: z.literal(200),
      capturedAt: z.string(),
      body: z.string(),
    }),
  )
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL("./oemgarage-test-fixtures/native.json.gz", import.meta.url),
        ),
      ).toString(),
    ),
  );
export function oemgarageFixture(name: string) {
  const capture = captures[name];
  if (!capture)
    throw new Error("Missing actual saved oeM Garage capture: " + name);
  return capture;
}
export function oemgarageOpeningFixture() {
  return z
    .object({
      catalog: OemgarageCatalogSchema,
      records: z.array(OemgarageRecordSchema),
    })
    .strict()
    .parse(
      JSON.parse(
        gunzipSync(
          readFileSync(
            new URL(
              "./oemgarage-test-fixtures/opening.json.gz",
              import.meta.url,
            ),
          ),
        ).toString(),
      ),
    );
}
