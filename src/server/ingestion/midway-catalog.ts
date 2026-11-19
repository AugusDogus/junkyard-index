import { createHash } from "node:crypto";
import { Effect } from "effect";
import { fetchMidwayMakeCatalog, MidwayProviderError } from "./midway-client";
import {
  parseMidwayCatalog,
  parseMidwayMakeDirectory,
  type MidwayRecord,
} from "./midway-parser";
import type { MidwayInventoryCode } from "./midway-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Durable fingerprint of one exact native donor row. */
export const midwayRecordDigest = (record: MidwayRecord) => digest(record);

/**
 * A capped broad view is a coverage witness, never an admitted enumeration.
 * The opening census fixes the make controls to traverse, the witness rows
 * each make page must reproduce exactly, and the fingerprint the closing broad
 * view must match. Only digests are kept so the census fits in a checkpoint.
 */
export function openMidwayMakeCensus(
  opening: string,
  code: MidwayInventoryCode,
) {
  const makes = parseMidwayMakeDirectory(opening, code);
  const witness = parseMidwayCatalog(opening, code, undefined, true);
  return {
    makes,
    witness: [...new Set(witness.map(midwayRecordDigest))],
    openingHash: digest(witness),
  };
}

/** The closing broad view must equal the opening one, or a donor may have
 * moved between make controls while they were being traversed. */
export function closeMidwayMakeCensus(
  closing: string,
  code: MidwayInventoryCode,
  census: { witness: readonly string[]; openingHash: string },
) {
  if (census.witness.length)
    throw new Error(
      `Midway make traversal missed or changed ${census.witness.length} donors in the broad inventory witness`,
    );
  if (
    digest(parseMidwayCatalog(closing, code, undefined, true)) !==
    census.openingHash
  )
    throw new Error(
      "Midway broad closing witness changed during make enumeration",
    );
}

export function fetchMidwayMakeRecords(
  code: MidwayInventoryCode,
  make: string,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const html = yield* fetchMidwayMakeCatalog(code, make, gate);
    return yield* Effect.try({
      try: () => parseMidwayCatalog(html, code, make),
      catch: (cause) =>
        new MidwayProviderError({ operation: code + " make " + make, cause }),
    });
  });
}
