import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  parseHollanderstoresPage,
  type HollanderstoresPage,
} from "../hollanderstores-parser";
import { HOLLANDERSTORES_YARDS } from "../hollanderstores-yard-metadata";

export function hollanderstoresFixtureBytes(file: string): Buffer {
  const path = [
    `${import.meta.dir}/${file}`,
    `${import.meta.dir}/expansion/${file}`,
    `${import.meta.dir}/pauls/${file}`,
    `${import.meta.dir}/batch-2/${file}`,
    `${import.meta.dir}/west-plains/${file}`,
    `${import.meta.dir}/east/${file}`,
    `${import.meta.dir}/mid-states/${file}`,
    `${import.meta.dir}/sweep/${file}`,
  ].find((path) => existsSync(path));
  if (!path) throw new Error("Saved Hollander response missing: " + file);
  return gunzipSync(readFileSync(path));
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

// Each qualification retains its independent frozen census. Merge shared yards
// once so later provider batches extend the same complete replay oracle.
const qualificationSchema = z.object({
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
});
const qualifications = [
  "stricker",
  "west-plains",
  "east",
  "mid-states",
  "sweep",
].map((directory) =>
  qualificationSchema.parse(
    JSON.parse(
      readFileSync(
        `${import.meta.dir}/${directory}/qualification.json`,
        "utf8",
      ),
    ),
  ),
);
const perYard = new Map(
  qualifications.flatMap((qualification) =>
    qualification.perYard.map((yard) => [yard.code, yard] as const),
  ),
);
export const hollanderstoresExpected = {
  perYard: HOLLANDERSTORES_YARDS.map((yard) => {
    const census = perYard.get(yard.code);
    if (!census)
      throw new Error("Missing frozen Hollander census: " + yard.code);
    return census;
  }),
  count: [...perYard.values()].reduce((sum, yard) => sum + yard.accepted, 0),
  observedVins: [
    ...new Set(qualifications.flatMap((q) => q.observedVins)),
  ].sort(),
  failedMakeVins: [
    ...new Set(qualifications.flatMap((q) => q.failedMakeVins)),
  ].sort(),
};
