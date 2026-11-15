import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  parseScottsDirectory,
  parseScottsModel,
  scottsHash,
  type ScottsRecord,
} from "./scotts-parser";

// Actual complete native HTTP200 bodies captured 2026-11-15 UTC. Full dated
// receipts remain in research/mt_wy_id_ut_co/refill-02/evidence/.
export const scottsFixture = (
  name: "root" | "makes" | "acura" | "cl" | "mdx",
) =>
  gunzipSync(
    readFileSync(
      new URL(`./scotts-test-fixtures/${name}.html.gz`, import.meta.url),
    ),
  ).toString("utf8");

function required<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error("Native Scott's fixture control is missing");
  return value;
}
export const scottsMake = required(
  parseScottsDirectory(scottsFixture("makes"), "makes").find(
    (make) => make.label === "ACURA",
  ),
);
export const scottsModel = required(
  parseScottsDirectory(scottsFixture("acura"), "models", scottsMake).find(
    (model) => model.label === "CL",
  ),
);
export const scottsContext = {
  make: scottsMake.label,
  model: scottsModel.label,
  makePath: scottsMake.path,
};
export const scottsRecords = parseScottsModel(
  scottsFixture("cl"),
  scottsMake,
  scottsModel,
).records;
export const scottsPage = (records: ScottsRecord[]) => ({
  records,
  hash: scottsHash(records),
});
