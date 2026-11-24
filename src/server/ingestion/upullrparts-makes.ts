import { Effect } from "effect";
import { z } from "zod";
import { normalizeCanonicalMake } from "./normalization";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  fetchUpullRPartsMakes,
  fetchUpullRPartsModels,
  UPULLRPARTS_MAX_MAKES,
  type UpullRPartsProviderError,
} from "./upullrparts-client";
import type {
  UpullRPartsLocation,
  UpullRPartsSearch,
} from "./upullrparts-date-crawl";

const label = z.string().trim().min(1).max(100);

/**
 * getMakes and each make's getModels, loaded once per run in its own chunk
 * and stored with that chunk's checkpoint, so crawl chunks spend none of
 * their work limit on about 60 directory requests.
 */
export const UpullRPartsDirectorySchema = z
  .object({
    version: z.literal(1),
    makes: z.array(label).min(1).max(UPULLRPARTS_MAX_MAKES),
    models: z.record(z.string(), z.array(label).max(500)),
  })
  .strict();
export type UpullRPartsDirectory = z.infer<typeof UpullRPartsDirectorySchema>;

/** A directory model label (trimmed, upper case) to the canonical makes that
 * list it, each with the provider's spelling for a search. */
export type UpullRPartsModelIndex = ReadonlyMap<
  string,
  ReadonlyMap<string, string>
>;

export function upullRPartsModelLabel(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

export const UpullRPartsDirectory = {
  load(
    requestGate: ProviderRequestGate,
  ): Effect.Effect<UpullRPartsDirectory, UpullRPartsProviderError> {
    return Effect.gen(function* () {
      const makes = [...(yield* fetchUpullRPartsMakes(requestGate))];
      const models: Record<string, string[]> = {};
      for (const make of makes)
        models[make] = [...(yield* fetchUpullRPartsModels(make, requestGate))];
      return { version: 1, makes, models } as const;
    });
  },

  /**
   * Which makes list each model label. Labels shared by makes that are one
   * canonical make (such as two spellings) are not ambiguous; labels such as
   * MUSTANG or FORD E250 VAN that two canonical makes list are.
   */
  index(directory: UpullRPartsDirectory): UpullRPartsModelIndex {
    const index = new Map<string, Map<string, string>>();
    for (const make of directory.makes) {
      const canonical = normalizeCanonicalMake(make);
      if (canonical === "Other") continue;
      for (const model of directory.models[make] ?? []) {
        const name = upullRPartsModelLabel(model);
        const makes = index.get(name) ?? new Map<string, string>();
        if (!makes.has(canonical)) makes.set(canonical, make);
        index.set(name, makes);
      }
    }
    return index;
  },
} as const;

/** A new vehicle whose make the crawl must find; date rows carry no make. */
export interface UpullRPartsMakeQuery {
  vin: string;
  year: number;
  model: string;
  /** Its arrival day, or null when the row has none. */
  day: string | null;
}

/** Decodes VINs (with model years) to canonical makes; a VIN it cannot
 * decode is absent. It never fails: an unavailable decoder decodes none. */
export type UpullRPartsVinMakes = (
  vehicles: readonly { vin: string; year: number }[],
) => Effect.Effect<ReadonlyMap<string, string>>;

/**
 * Canonical makes for `vehicles`, by VIN, from the first source that knows
 * each: its make in the published snapshot (`known`); the one canonical make
 * whose getModels lists its model; for a model two makes list, one search of
 * its arrival day and each candidate make (at most `searchBudget` searches,
 * one per day and make, each started only while `mayStart` allows); its
 * decoded VIN. A vehicle none of them resolve is listed under Other with a
 * warning naming it, never silently.
 */
export function resolveUpullRPartsMakes<S>(params: {
  site: UpullRPartsLocation;
  vehicles: readonly UpullRPartsMakeQuery[];
  known: ReadonlyMap<string, string>;
  index: UpullRPartsModelIndex;
  search: UpullRPartsSearch<S>;
  searchBudget: number;
  mayStart: () => boolean;
  decodeVins: UpullRPartsVinMakes;
}): Effect.Effect<
  { makes: Map<string, string>; searches: number; warnings: string[] },
  S
> {
  return Effect.gen(function* () {
    const makes = new Map<string, string>();
    const ambiguous: (UpullRPartsMakeQuery & {
      candidates: ReadonlyMap<string, string>;
    })[] = [];
    const undecided: UpullRPartsMakeQuery[] = [];
    for (const vehicle of params.vehicles) {
      const stored = params.known.get(vehicle.vin);
      if (stored !== undefined && stored !== "Other") {
        makes.set(vehicle.vin, stored);
        continue;
      }
      const candidates = params.index.get(upullRPartsModelLabel(vehicle.model));
      const [only] = candidates?.keys() ?? [];
      if (candidates?.size === 1 && only !== undefined)
        makes.set(vehicle.vin, only);
      else if (candidates !== undefined && candidates.size > 1 && vehicle.day)
        ambiguous.push({ ...vehicle, candidates });
      else undecided.push(vehicle);
    }

    // One search per arrival day and candidate make, newest day first.
    const pairs = new Map<string, { day: string; make: string; raw: string }>();
    for (const vehicle of ambiguous)
      for (const [make, raw] of vehicle.candidates)
        if (vehicle.day)
          pairs.set(`${vehicle.day}|${make}`, { day: vehicle.day, make, raw });
    const ordered = [...pairs.values()].sort((a, b) =>
      a.day === b.day ? (a.make < b.make ? -1 : 1) : a.day < b.day ? 1 : -1,
    );
    const searched = new Set<string>();
    const foundUnder = new Map<string, Set<string>>();
    let searches = 0;
    for (const pair of ordered.slice(0, Math.max(0, params.searchBudget))) {
      if (!params.mayStart()) break;
      const rows = yield* params.search({
        site: params.site,
        beginDate: pair.day,
        endDate: pair.day,
        makes: pair.raw,
      });
      searches += 1;
      searched.add(`${pair.day}|${pair.make}`);
      for (const row of rows) {
        const vin =
          typeof row === "object" && row !== null && "VIN" in row
            ? String(row.VIN).trim().toUpperCase()
            : "";
        if (!vin) continue;
        const under = foundUnder.get(vin) ?? new Set<string>();
        under.add(pair.make);
        foundUnder.set(vin, under);
      }
    }
    for (const vehicle of ambiguous) {
      const found = [...(foundUnder.get(vehicle.vin) ?? [])].filter((make) =>
        vehicle.candidates.has(make),
      );
      const [make] = found;
      if (found.length === 1 && make !== undefined)
        makes.set(vehicle.vin, make);
      else undecided.push(vehicle);
    }

    const warnings: string[] = [];
    const skipped = ordered.length - searched.size;
    if (skipped > 0)
      warnings.push(
        `U Pull R Parts location ${params.site}: ${skipped} day and make searches for models more than one make lists did not fit this chunk's search budget or time, so their vehicles' makes come from a VIN decode.`,
      );
    const decoded =
      undecided.length === 0
        ? new Map<string, string>()
        : yield* params.decodeVins(undecided);
    const unresolved: UpullRPartsMakeQuery[] = [];
    for (const vehicle of undecided) {
      const make = decoded.get(vehicle.vin);
      if (make !== undefined && make !== "Other") makes.set(vehicle.vin, make);
      else unresolved.push(vehicle);
    }
    for (const vehicle of unresolved) makes.set(vehicle.vin, "Other");
    if (unresolved.length > 0)
      warnings.push(
        `U Pull R Parts location ${params.site}: ${unresolved.length} new vehicles have no make from the published snapshot, the model directory, a day and make search or a VIN decode, so they are listed under Other: ${unresolved
          .slice(0, 5)
          .map((vehicle) => `${vehicle.vin} (${vehicle.model})`)
          .join(
            ", ",
          )}. Their inventory is published; look their models up on upullrparts.com, and each daily crawl resolves them again.`,
      );
    return { makes, searches, warnings };
  });
}
