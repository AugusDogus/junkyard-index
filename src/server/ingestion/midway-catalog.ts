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
 * A broad view is a capped newest-first coverage witness for every yard, never
 * an admitted enumeration: Muncie and Liberty stop well below 500 rows at a
 * cap that varies by day and cuts mid-date. The opening census fixes the make
 * controls to traverse, the witness rows each make page must reproduce
 * exactly, the fingerprint the closing broad view must match, and the row
 * count no make page may reach. Only digests are kept so the census fits in a
 * checkpoint.
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
    openingRows: witness.length,
  };
}

/**
 * The opening broad view stopped at `openingRows`, which proves the native cap
 * can be that low. A make page that large may be capped the same way, so its
 * partition cannot be proven complete.
 */
export function assertMidwayMakePartition(
  rows: number,
  code: MidwayInventoryCode,
  make: string,
  openingRows: number,
) {
  if (rows >= openingRows)
    throw new Error(
      `Midway ${code} make ${make} listed ${rows} donors, at least the ${openingRows}-row broad view that may itself be capped; this make page may be truncated and its completeness cannot be verified`,
    );
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
