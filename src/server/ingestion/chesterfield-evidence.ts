import { createHash } from "node:crypto";
import type { ChesterfieldRecord } from "./chesterfield-parser";
import { chesterfieldPhotoIdentity } from "./chesterfield-photo";

export const chesterfieldHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const chesterfieldDonorKey = (record: { yard: string; stock: string }) =>
  JSON.stringify([record.yard, record.stock]);
export const chesterfieldIdentity = (record: ChesterfieldRecord) =>
  chesterfieldHash([
    record.yard,
    record.stock,
    record.vin,
    record.year,
    record.make,
    record.model,
  ]);

/** Expiry signatures may rotate. Compare the native image owners, never renewed URLs. */
export const chesterfieldDescription = (record: ChesterfieldRecord) =>
  chesterfieldHash({
    ...record,
    images: record.images.map((url) => chesterfieldPhotoIdentity(url) ?? url),
  });

export function chesterfieldPageHash(records: ChesterfieldRecord[]): string {
  return chesterfieldHash(records.map(chesterfieldDescription));
}
