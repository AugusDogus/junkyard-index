import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  JimsimportControlSchema,
  JimsimportMenuSchema,
  JimsimportPageSchema,
} from "./jimsimport-parser";

function read(name: string): unknown {
  return JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./jimsimport-test-fixtures/" + name + ".json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  );
}
const native = z
  .record(
    z.string(),
    z.object({
      body: z.string(),
      url: z.string(),
      status: z.literal(200),
      capturedAt: z.string(),
    }),
  )
  .parse(read("native"));
export function jimsimportFixture(name: string) {
  const capture = native[name];
  if (!capture)
    throw new Error("Missing actual native Jim's Import capture: " + name);
  return capture;
}
export function jimsimportOpeningFixture() {
  return z
    .object({
      makes: z.array(JimsimportControlSchema),
      menus: z.array(JimsimportMenuSchema),
      pages: z.array(JimsimportPageSchema),
    })
    .strict()
    .parse(read("opening"));
}
