import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";

const FixtureSchema = z
  .object({
    catalog: z.string(),
    contact: z.string(),
    details: z.array(z.tuple([z.string(), z.string()])),
  })
  .strict();
type Fixtures = z.infer<typeof FixtureSchema>;
const optionalText = z.string().nullable();
const OracleSchema = z.array(
  z
    .object({
      source: z.literal("six03"),
      vin: z.string(),
      year: z.number().int(),
      make: z.string(),
      model: z.string(),
      stockNumber: optionalText,
      imageUrl: optionalText,
      availableDate: optionalText,
      color: optionalText,
      locationCode: z.string(),
      locationName: z.string(),
      locationCity: z.string(),
      state: z.string(),
      stateAbbr: z.string(),
      lat: z.number(),
      lng: z.number(),
      detailsUrl: optionalText,
      partsUrl: optionalText,
      pricesUrl: optionalText,
      section: optionalText,
      row: optionalText,
      space: optionalText,
      engine: optionalText,
      trim: optionalText,
      transmission: optionalText,
    })
    .strict(),
);
let cached: Fixtures | undefined;
export function six03NativeFixtures(): Fixtures {
  if (cached) return cached;
  const wire = gunzipSync(
    readFileSync(
      new URL("./six03-test-fixtures/native-census.json.gz", import.meta.url),
    ),
  ).toString("utf8");
  const candidate: unknown = JSON.parse(wire);
  cached = FixtureSchema.parse(candidate);
  return cached;
}

export function six03FixtureDetail(path: string): string {
  if (path === "/parts-vehicles/2007-jeep-commander-black/")
    return gunzipSync(
      readFileSync(
        new URL("./six03-test-fixtures/jeep-native.html.gz", import.meta.url),
      ),
    ).toString("utf8");
  const value = six03NativeFixtures().details.find(
    ([candidate]) => candidate === path,
  )?.[1];
  if (!value) throw new Error("Missing saved six03 fixture " + path);
  return value;
}

export function six03IndependentOracle() {
  const wire = gunzipSync(
    readFileSync(
      new URL(
        "./six03-test-fixtures/independent-oracle.json.gz",
        import.meta.url,
      ),
    ),
  ).toString("utf8");
  const candidate: unknown = JSON.parse(wire);
  return OracleSchema.parse(candidate);
}
