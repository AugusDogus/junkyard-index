/** Read-only production census plus a resumable, serial vPIC sample.
 * bun scripts/report-vin-canonicalization.ts --credentials=/path/to/.env
 * Outputs public inventory data under .scratchpad/vin-dry-run. No DB/Algolia writes.
 */
import { createClient } from "@libsql/client/web";
import { parse } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { ConsumerModel } from "../src/lib/consumer-model";
import { VinDecode } from "../src/server/ingestion/vin-decode";
import { createVpicClient } from "../src/server/ingestion/vpic-client";
import { normalizeCanonicalMake } from "../src/server/ingestion/normalization";
import { VehicleName } from "../src/lib/vehicle-name";
import {
  auditVinModelUrls,
  modelFacetSchema,
  storedModelSnapshotSchema,
} from "./vin-model-url-audit";

const rowSchema = z.object({
  vin: z.string(),
  year: z.number(),
  make: z.string(),
  model: z.string(),
  count: z.number(),
});
const decodeSchema = z.object({
  make: z.string(),
  model: z.string(),
  year: z.number(),
  trim: z.string().nullable(),
  series: z.string().nullable().optional(),
  series2: z.string().nullable().optional(),
  driveType: z.string().nullable().optional(),
  electrificationLevel: z.string().nullable().optional(),
});
const makes = ["Ford", "Chevrolet", "Toyota", "Honda"];
const directory = ".scratchpad/vin-dry-run";
const patternSql = `substr(upper(trim(vin)),1,8)||substr(upper(trim(vin)),10,2)||case when substr(upper(trim(vin)),3,1)='9' then substr(upper(trim(vin)),12,3) else '' end||':'||year`;
const validSql = `year between 1981 and 2100 and length(trim(vin))=17 and upper(trim(vin)) not glob '*[^A-HJ-NPR-Z0-9]*' and substr(upper(trim(vin)),10,1)=substr('ABCDEFGHJKLMNPRSTVWXY123456789',((year-1980)%30)+1,1)`;

export async function reportVinCanonicalization() {
  await mkdir(directory, { recursive: true });
  const credentialPath = process.argv
    .find((arg) => arg.startsWith("--credentials="))
    ?.slice("--credentials=".length);
  const environment = credentialPath
    ? parse(await readFile(credentialPath))
    : process.env;
  const database = createClient({
    url: z.string().min(1).parse(environment.TURSO_DATABASE_URL),
    authToken: environment.TURSO_AUTH_TOKEN,
  });
  let rows: z.infer<typeof rowSchema>[];
  let census;
  let storedSnapshots: z.infer<typeof storedModelSnapshotSchema>[];
  let modelFacets: z.infer<typeof modelFacetSchema>[];
  let boundedBackfillRequests = 0;
  try {
    const result = await database.execute(
      `select count(*) total, sum(missing_since_at is null) live, count(distinct case when ${validSql} then ${patternSql} end) patterns from vehicle`,
    );
    census = result.rows;
    const bounded = await database.execute(`with ordered as (
      select vin, year, (row_number() over(order by vin)-1)/100 batch from vehicle
    ), firsts as (
      select ${patternSql} pattern, min(batch) first_batch from ordered
      where ${validSql} group by pattern
    ), batches as (
      select first_batch, count(*) misses from firsts group by first_batch
    ) select coalesce(sum((misses+49)/50),0) requests from batches`);
    boundedBackfillRequests = z.number().parse(bounded.rows[0]?.requests);
    const groups = await database.execute(
      `select min(upper(trim(vin))) vin, year, make, model, count(*) count from vehicle where missing_since_at is null group by ${patternSql}, year, make, model`,
    );
    rows = z.array(rowSchema).parse(groups.rows);
    const snapshots = await database.execute(
      "select key,data from inventory_snapshot where key like '%:make-%'",
    );
    storedSnapshots = z.array(storedModelSnapshotSchema).parse(snapshots.rows);
    const facets = await database.execute(
      "select make,model,count(*) count from vehicle where missing_since_at is null group by make,model",
    );
    modelFacets = z.array(modelFacetSchema).parse(facets.rows);
  } finally {
    database.close();
  }
  await writeFile(`${directory}/groups.json`, JSON.stringify(rows));
  await writeFile(
    `${directory}/snapshots.json`,
    JSON.stringify(storedSnapshots),
  );
  await writeFile(`${directory}/facets.json`, JSON.stringify(modelFacets));
  const selected = new Map<
    string,
    NonNullable<ReturnType<typeof VinDecode.identity>>
  >();
  for (const make of makes) {
    const candidates = [
      ...new Map(
        rows
          .filter((row) => normalizeCanonicalMake(row.make) === make)
          .flatMap((row) => {
            const id = VinDecode.identity(row.vin, row.year);
            return id ? [[id.key, id] as const] : [];
          }),
      ).values(),
    ].sort((a, b) => a.key.localeCompare(b.key));
    const size = Math.min(500, candidates.length);
    for (let i = 0; i < size; i++) {
      const id = candidates[Math.floor((i * candidates.length) / size)];
      if (id) selected.set(id.key, id);
    }
  }
  const decoded = new Map<string, z.infer<typeof decodeSchema>>();
  // The checkpoint is local public decode data, never a production DB cache.
  try {
    const previous = z
      .array(z.tuple([z.string(), decodeSchema]))
      .parse(JSON.parse(await readFile(`${directory}/decodes.json`, "utf8")));
    for (const [key, value] of previous)
      if (selected.has(key)) decoded.set(key, value);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  let requests = 0;
  const client = createVpicClient();
  const pending = [...selected.values()].filter((id) => !decoded.has(id.key));
  for (let start = 0; start < pending.length; start += 50) {
    requests++;
    const batch = await client.decode(pending.slice(start, start + 50));
    for (const [key, value] of batch) decoded.set(key, value);
    await writeFile(`${directory}/decodes.json`, JSON.stringify([...decoded]));
    console.info(
      `[vPIC sample] ${Math.min(start + 50, pending.length)}/${pending.length} attempted; ${decoded.size} accepted`,
    );
  }
  const report = summarizeVinSample(rows, selected, decoded);
  const result = {
    capturedAt: new Date().toISOString(),
    census,
    boundedBackfillRequests,
    idealBatchRequests: Math.ceil(Number(census[0]?.patterns) / 50),
    samplePatterns: selected.size,
    acceptedPatterns: decoded.size,
    batchesThisRun: requests,
    modelUrls: auditVinModelUrls(storedSnapshots, modelFacets, rows, decoded),
    ...report,
  };
  await writeFile(`${directory}/report.json`, JSON.stringify(result, null, 2));
  console.info(JSON.stringify(result, null, 2));
}

export function summarizeVinSample(
  rows: z.infer<typeof rowSchema>[],
  selected: ReadonlyMap<string, { vin: string; year: number }>,
  decoded: ReadonlyMap<string, z.infer<typeof decodeSchema>>,
) {
  const mismatch = new Map<
    string,
    {
      sourceMake: string;
      sourceModel: string;
      make: string;
      model: string;
      vehicles: number;
    }
  >();
  const facets = makes.map((make) => {
    const before = new Set<string>();
    const after = new Set<string>();
    const inventoryBefore = new Set<string>();
    const inventoryAfter = new Set<string>();
    let vehicles = 0;
    let acceptedVehicles = 0;
    for (const row of rows) {
      const id = VinDecode.identity(row.vin, row.year);
      const inSample = id && selected.has(id.key);
      const identity = inSample ? decoded.get(id.key) : undefined;
      const sourceMake = normalizeCanonicalMake(row.make);
      const sourceModel = VehicleName.modelName(sourceMake, row.model);
      const targetMake = identity?.make ?? sourceMake;
      const targetModel = identity
        ? ConsumerModel.resolve({ ...identity, sourceModel: row.model })
        : sourceModel;
      if (sourceMake === make) inventoryBefore.add(row.model);
      if (targetMake === make) inventoryAfter.add(targetModel);
      if (!inSample) continue;
      if (sourceMake === make) {
        before.add(row.model);
        vehicles += row.count;
        if (identity) acceptedVehicles += row.count;
      }
      if (targetMake === make) after.add(targetModel);
      if (
        identity &&
        (VehicleName.makeKey(row.make) !== VehicleName.makeKey(identity.make) ||
          VehicleName.modelKey(sourceMake, sourceModel) !==
            VehicleName.modelKey(targetMake, targetModel))
      ) {
        const key = JSON.stringify([
          row.make,
          row.model,
          targetMake,
          targetModel,
        ]);
        // Process mismatches once, in the source make's iteration.
        if (sourceMake === make)
          mismatch.set(key, {
            sourceMake: row.make,
            sourceModel: row.model,
            make: targetMake,
            model: targetModel,
            vehicles: (mismatch.get(key)?.vehicles ?? 0) + row.count,
          });
      }
    }
    return {
      make,
      vehicles,
      acceptedVehicles,
      before: before.size,
      after: after.size,
      inventoryBefore: inventoryBefore.size,
      inventoryAfter: inventoryAfter.size,
    };
  });
  return {
    facets,
    mismatches: [...mismatch.values()].sort((a, b) => b.vehicles - a.vehicles),
  };
}

if (import.meta.main) await reportVinCanonicalization();
