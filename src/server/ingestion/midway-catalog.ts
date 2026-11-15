import { Effect } from "effect";
import { fetchMidwayMakeCatalog, MidwayProviderError } from "./midway-client";
import {
  parseMidwayCatalog,
  parseMidwayMakeDirectory,
  type MidwayRecord,
} from "./midway-parser";
import type { MidwayInventoryCode } from "./midway-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";

/** A capped broad view is a coverage witness, never an admitted enumeration. */
export function fetchMidwayMakeEnumeration(
  opening: string,
  code: MidwayInventoryCode,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const makes = yield* Effect.try({
      try: () => parseMidwayMakeDirectory(opening, code),
      catch: (cause) =>
        new MidwayProviderError({ operation: "make directory", cause }),
    });
    const records: MidwayRecord[] = [];
    for (const make of makes) {
      const html = yield* fetchMidwayMakeCatalog(code, make, gate);
      const rows = yield* Effect.try({
        try: () => parseMidwayCatalog(html, code, make),
        catch: (cause) =>
          new MidwayProviderError({ operation: code + " make " + make, cause }),
      });
      records.push(...rows);
    }
    yield* Effect.try({
      try: () => {
        const witness = parseMidwayCatalog(opening, code, undefined, true);
        const observed = new Set(
          records.map((record) => JSON.stringify(record)),
        );
        if (witness.some((record) => !observed.has(JSON.stringify(record))))
          throw new Error(
            "Midway make traversal missed or changed a donor in the broad inventory witness",
          );
      },
      catch: (cause) =>
        new MidwayProviderError({ operation: "make coverage witness", cause }),
    });
    return records;
  });
}
