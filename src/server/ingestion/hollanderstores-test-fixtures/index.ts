import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  parseHollanderstoresPage,
  type HollanderstoresPage,
} from "../hollanderstores-parser";
import { HOLLANDERSTORES_YARDS } from "../hollanderstores-yard-metadata";

export function hollanderstoresFixtureBytes(file: string): Buffer {
  const base = `${import.meta.dir}/${file}`;
  return gunzipSync(
    readFileSync(
      existsSync(base) ? base : `${import.meta.dir}/expansion/${file}`,
    ),
  );
}
export const hollanderstoresFixtureBody = (file: string) =>
  hollanderstoresFixtureBytes(file).toString("utf8");
export const hollanderstoresFixture = (code: string) =>
  hollanderstoresFixtureBody(code + ".html.gz");
let parsed: HollanderstoresPage[] | undefined;
export function hollanderstoresFixturePages(): HollanderstoresPage[] {
  parsed ??= HOLLANDERSTORES_YARDS.map((yard, index) =>
    parseHollanderstoresPage(hollanderstoresFixture(yard.code), index),
  );
  return structuredClone(parsed);
}

export const hollanderstoresExpected = z
  .object({
    perYard: z.array(
      z.object({
        code: z.string(),
        accepted: z.number(),
        rejected: z.number(),
        duplicates: z.number(),
        total: z.number(),
      }),
    ),
    count: z.number(),
    observedVins: z.array(z.string()),
    failedMakeVins: z.array(z.string()),
  })
  .parse(
    JSON.parse(
      readFileSync(`${import.meta.dir}/expansion/qualification.json`, "utf8"),
    ),
  );
