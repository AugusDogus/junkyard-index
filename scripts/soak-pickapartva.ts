import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { Effect } from "effect";
import { z } from "zod";
import { connectorChunkMetrics } from "../src/server/ingestion/connector-chunk";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "../src/server/ingestion/durable-cursor";
import {
  streamPickapartvaInventoryWithRequestGate,
  type PickapartvaStreamResult,
} from "../src/server/ingestion/pickapartva-connector";
import { PickapartvaCursor } from "../src/server/ingestion/pickapartva-cursor";
import type { PickapartvaCanonicalVehicle } from "../src/server/ingestion/pickapartva-transform";

/** Count/discard driver. The caller decides transport and persistence. */
export async function soakPickapartvaInventory(
  runChunk: (
    cursor: PickapartvaCursor,
    maxPages: number,
  ) => Promise<PickapartvaStreamResult>,
  maxPages = 15,
  chunkPages = 15,
): Promise<PickapartvaStreamResult> {
  if (
    ![maxPages, chunkPages].every(
      (value) => Number.isSafeInteger(value) && value >= 1 && value <= 15,
    )
  )
    throw new Error(
      "Pick-A-Part VA soak requires 1-15 raw-page emission units",
    );
  const summary: PickapartvaStreamResult = {
    source: "pickapartva",
    status: "paused",
    cursor: PickapartvaCursor.initial,
    count: 0,
    pagesProcessed: 0,
    errors: [],
    warnings: [],
    observedVins: [],
    accounting: {
      recordsProcessed: 0,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    },
  };
  const observed = new Set<string>();
  while (summary.pagesProcessed < maxPages) {
    const chunk = await runChunk(
      summary.cursor,
      Math.min(chunkPages, maxPages - summary.pagesProcessed),
    );
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 ||
        JSON.stringify(chunk.cursor) === JSON.stringify(summary.cursor))
    )
      throw new Error(
        "Pick-A-Part VA soak made no progress; retain the validated checkpoint",
      );
    summary.count += chunk.count;
    summary.pagesProcessed += chunk.pagesProcessed;
    summary.errors.push(...chunk.errors);
    summary.warnings = [
      ...new Set([...(summary.warnings ?? []), ...(chunk.warnings ?? [])]),
    ];
    for (const vin of chunk.observedVins ?? []) observed.add(vin);
    if (summary.accounting && chunk.accounting) {
      summary.accounting.recordsProcessed += chunk.accounting.recordsProcessed;
      summary.accounting.recordsExcluded += chunk.accounting.recordsExcluded;
      summary.accounting.recordsRejected += chunk.accounting.recordsRejected;
      summary.accounting.duplicateVehicles +=
        chunk.accounting.duplicateVehicles;
    }
    summary.cursor = chunk.cursor;
    summary.status = chunk.status;
    summary.observedVins = [...observed];
    if (chunk.status !== "paused") break;
  }
  return summary;
}

const receiptSchema = z.object({
  url: z.string(),
  status: z.literal(200),
  error: z.null(),
  bodyTruncated: z.literal(false),
  body: z.object({
    file: z.string(),
    bytes: z.number().int(),
    sha256: z.string(),
  }),
});

/** Explicit saved transport: never falls through to real fetch or writes services. */
async function replaySaved(
  evidence: string,
  output: string,
  chunkPages: number,
  searches: string | undefined,
) {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const occurrences = new Map<number, number>();
  const vehicles: PickapartvaCanonicalVehicle[] = [];
  const chunks: Array<{
    result: PickapartvaStreamResult;
    serializedCursor: string;
    metrics: ReturnType<typeof connectorChunkMetrics>;
    savedReads: number;
  }> = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const rawUrl = input instanceof Request ? input.url : String(input);
      const url = new URL(rawUrl);
      if (
        url.origin !== "https://pickapartva.com" ||
        url.pathname !== "/inventory/ANY/ANY/"
      )
        throw new Error(
          "Saved replay refused unexpected native destination " + rawUrl,
        );
      const date = url.searchParams.get("search");
      if (date !== null) {
        // Set-date searches the census needs for repeated Set Dates. The
        // connector validates the body like a live response.
        if (searches === undefined)
          throw new Error(
            `Saved replay needs the set-date search ${rawUrl}, but no --searches directory was given. Pass a directory holding search-${date}.html for every repeated Set Date; nothing was written`,
          );
        const file = join(searches, `search-${date}.html`);
        const body = await readFile(file).catch((cause: unknown) => {
          throw new Error(
            `Saved replay needs the set-date search ${rawUrl}, but ${file} could not be read. Save that search body there and rerun; nothing was written`,
            { cause },
          );
        });
        requests.push(rawUrl);
        return new Response(
          new TextDecoder("utf-8", { fatal: true }).decode(body),
          {
            headers: {
              "content-type": "text/html; charset=UTF-8",
              "content-length": String(body.length),
            },
          },
        );
      }
      const page = Number(url.searchParams.get("pagenum"));
      const occurrence = (occurrences.get(page) ?? 0) + 1;
      occurrences.set(page, occurrence);
      const closing = [1, 2, 15].includes(page) && occurrence % 2 === 0;
      const name = closing
        ? `page${String(page).padStart(2, "0")}-closing`
        : page === 1
          ? "page01-opening"
          : page === 2
            ? "page02-probe"
            : `page${String(page).padStart(2, "0")}-census`;
      const receipt = receiptSchema.parse(
        JSON.parse(await readFile(join(evidence, name + ".json"), "utf8")),
      );
      const body = await readFile(join(evidence, name + ".body"));
      if (
        receipt.url !== rawUrl ||
        body.length !== receipt.body.bytes ||
        createHash("sha256").update(body).digest("hex") !== receipt.body.sha256
      )
        throw new Error("Saved native body/receipt binding changed: " + name);
      requests.push(rawUrl);
      return new Response(
        new TextDecoder("utf-8", { fatal: true }).decode(body),
        {
          headers: {
            "content-type": "text/html; charset=UTF-8",
            "content-length": String(body.length),
          },
        },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
  try {
    const result = await soakPickapartvaInventory(
      async (cursor, maxPages) => {
        const before = requests.length;
        const fromWire = parseDurableSourceCursor(
          "pickapartva",
          serializeDurableSourceCursor(cursor),
        );
        const chunk = await Effect.runPromise(
          streamPickapartvaInventoryWithRequestGate(
            {
              startCursor: fromWire,
              maxPages,
              onBatch: (batch) =>
                Effect.sync(() => {
                  vehicles.push(...batch);
                }),
            },
            gate,
          ),
        );
        chunks.push({
          result: chunk,
          serializedCursor: serializeDurableSourceCursor(chunk.cursor),
          metrics: connectorChunkMetrics(chunk, chunk.count),
          savedReads: requests.length - before,
        });
        return chunk;
      },
      15,
      chunkPages,
    );
    const beforeTerminal = requests.length;
    const terminal = await Effect.runPromise(
      streamPickapartvaInventoryWithRequestGate(
        {
          startCursor: parseDurableSourceCursor(
            "pickapartva",
            serializeDurableSourceCursor(result.cursor),
          ),
          onBatch: () =>
            Effect.die("Terminal replay emitted a duplicate batch"),
        },
        gate,
      ),
    );
    if (
      requests.length !== beforeTerminal ||
      terminal.count !== 0 ||
      terminal.pagesProcessed !== 0
    )
      throw new Error("Complete replay was not idempotent");
    await mkdir(output, { recursive: true });
    const report = {
      evidenceDirectory: evidence,
      sourceManifest: join(dirname(evidence), "artifact-hashes.json"),
      nativeHttpRequests: 0,
      savedReads: requests.length,
      chunkPages,
      result,
      chunks,
      metrics: connectorChunkMetrics(result, vehicles.length),
      emittedUniqueVins: new Set(vehicles.map((vehicle) => vehicle.vin)).size,
      perYard: {
        TT87: vehicles.filter((vehicle) => vehicle.locationCode === "TT87")
          .length,
        UU81: vehicles.filter((vehicle) => vehicle.locationCode === "UU81")
          .length,
      },
      terminalReplay: terminal,
      terminalReplaySavedReads: requests.length - beforeTerminal,
    };
    await writeFile(
      join(output, "vehicles.json"),
      JSON.stringify(vehicles, null, 2) + "\n",
    );
    await writeFile(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(
      JSON.stringify(
        {
          status: result.status,
          count: result.count,
          savedReads: requests.length,
          nativeHttpRequests: 0,
          metrics: report.metrics,
          perYard: report.perYard,
          output,
        },
        null,
        2,
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      saved: { type: "string" },
      output: { type: "string" },
      "chunk-pages": { type: "string", default: "15" },
      searches: { type: "string" },
    },
  });
  if (!values.saved || !values.output)
    throw new Error(
      "Use --saved <frozen evidence directory> --output <local replay directory> [--chunk-pages 5|15] [--searches <directory of search-YYYY-MM-DD.html bodies>]. This command has no live transport.",
    );
  const chunkPages = z.coerce
    .number()
    .int()
    .min(1)
    .max(15)
    .parse(values["chunk-pages"]);
  await replaySaved(values.saved, values.output, chunkPages, values.searches);
}
