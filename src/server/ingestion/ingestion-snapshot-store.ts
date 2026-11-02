import { gunzipSync, gzipSync } from "node:zlib";
import { del, get, put } from "@vercel/blob";
import { z } from "zod";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";
import type { DurableIngestionSource } from "./durable-source";
import type { CanonicalVehicle } from "./types";

/**
 * One checkpointed chunk of a source run: the vehicles it fetched and the VINs
 * it observed without a usable snapshot. Chunks are staged outside the
 * database so a run's writes scale with inventory changes, not inventory size.
 */
export interface IngestionSnapshotChunk {
  vehicles: CanonicalVehicle[];
  observedVins: string[];
}

export interface IngestionSnapshotStore {
  /** Stores a chunk under a new, unique pathname and returns that pathname. */
  put(params: {
    runId: string;
    source: DurableIngestionSource;
    chunk: IngestionSnapshotChunk;
  }): Promise<string>;
  load(pathname: string): Promise<IngestionSnapshotChunk>;
  delete(pathnames: readonly string[]): Promise<void>;
}

const nullableText = z.string().nullable();
const CanonicalVehicleSchema = z.object({
  vin: z.string().min(1),
  source: z.enum(INGESTION_SOURCES),
  year: z.number(),
  make: z.string(),
  model: z.string(),
  color: nullableText,
  stockNumber: nullableText,
  imageUrl: nullableText,
  availableDate: nullableText,
  locationCode: z.string(),
  locationName: z.string(),
  locationCity: z.string(),
  state: z.string(),
  stateAbbr: z.string(),
  lat: z.number(),
  lng: z.number(),
  section: nullableText,
  row: nullableText,
  space: nullableText,
  detailsUrl: nullableText,
  partsUrl: nullableText,
  pricesUrl: nullableText,
  engine: nullableText,
  trim: nullableText,
  transmission: nullableText,
}) satisfies z.ZodType<CanonicalVehicle>;
const SnapshotChunkSchema = z.object({
  vehicles: z.array(CanonicalVehicleSchema),
  observedVins: z.array(z.string().min(1)),
});

const BLOB_PREFIX = "ingestion-runs";

function encode(chunk: IngestionSnapshotChunk): Buffer {
  return gzipSync(JSON.stringify(chunk));
}

function decode(pathname: string, body: Uint8Array): IngestionSnapshotChunk {
  const parsed = SnapshotChunkSchema.safeParse(
    JSON.parse(gunzipSync(body).toString("utf8")),
  );
  if (!parsed.success) {
    throw new Error(
      `Ingestion snapshot chunk ${pathname} is not a valid chunk: ${parsed.error.message}. The run cannot be reconciled from it; restart the run.`,
    );
  }
  return parsed.data;
}

export const IngestionSnapshotStore = {
  /** Private Vercel Blob store, authorized by BLOB_READ_WRITE_TOKEN. */
  vercelBlob(token: string): IngestionSnapshotStore {
    return {
      async put({ runId, source, chunk }) {
        const result = await put(
          `${BLOB_PREFIX}/${runId}/${source}/chunk.json.gz`,
          encode(chunk),
          {
            access: "private",
            addRandomSuffix: true,
            contentType: "application/gzip",
            token,
          },
        );
        return result.pathname;
      },
      async load(pathname) {
        const result = await get(pathname, {
          access: "private",
          useCache: false,
          token,
        });
        if (!result || result.statusCode !== 200) {
          throw new Error(
            `Ingestion snapshot chunk ${pathname} is missing from Blob storage. The run cannot be reconciled without it; restart the run.`,
          );
        }
        const body = new Uint8Array(
          await new Response(result.stream).arrayBuffer(),
        );
        return decode(pathname, body);
      },
      async delete(pathnames) {
        if (pathnames.length > 0) await del([...pathnames], { token });
      },
    };
  },

  memory(): IngestionSnapshotStore & { pathnames(): string[] } {
    const blobs = new Map<string, Uint8Array>();
    return {
      async put({ runId, source, chunk }) {
        const pathname = `${BLOB_PREFIX}/${runId}/${source}/${crypto.randomUUID()}.json.gz`;
        blobs.set(pathname, encode(chunk));
        return pathname;
      },
      async load(pathname) {
        const body = blobs.get(pathname);
        if (!body) {
          throw new Error(
            `Ingestion snapshot chunk ${pathname} is missing from memory.`,
          );
        }
        return decode(pathname, body);
      },
      async delete(pathnames) {
        for (const pathname of pathnames) blobs.delete(pathname);
      },
      pathnames: () => [...blobs.keys()],
    };
  },
} as const;
