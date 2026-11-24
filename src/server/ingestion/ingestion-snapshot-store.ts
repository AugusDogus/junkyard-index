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
  checkpointState?: unknown;
  /** The source crawl started over here: earlier chunks of this source run
   * no longer describe its inventory. */
  restart?: true;
}

export interface IngestionSnapshotStore {
  /** Stores a chunk under a new, unique pathname and returns that pathname. */
  put(params: {
    runId: string;
    source: DurableIngestionSource;
    chunk: IngestionSnapshotChunk;
  }): Promise<string>;
  /**
   * Stores one checkpoint's provider state alone, as a chunk with no vehicles,
   * under a new, unique pathname that {@link IngestionSnapshotStore.isCheckpointStatePath}
   * recognizes. Inventory loads skip these, so a large state is never
   * fetched once per chunk.
   */
  putCheckpointState(params: {
    runId: string;
    source: DurableIngestionSource;
    state: unknown;
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
  checkpointState: z.unknown().optional(),
  restart: z.literal(true).optional(),
});

const BLOB_PREFIX = "ingestion-runs";
const CHECKPOINT_STATE_FOLDER = "checkpoint-state";
const CHECKPOINT_STATE_PATH = new RegExp(
  `^${BLOB_PREFIX}/[^/]+/[^/]+/${CHECKPOINT_STATE_FOLDER}/[^/]+$`,
);
/** Waits between Blob read attempts; about 31 s in all before giving up. */
const BLOB_READ_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;
// Vercel Blob rejects a delete of more than 1,000 URLs, and a URG run stages
// more chunks than that.
const BLOB_DELETE_BATCH_SIZE = 1_000;

function encode(chunk: IngestionSnapshotChunk): Buffer {
  return gzipSync(JSON.stringify(chunk));
}

function checkpointStateChunk(state: unknown): IngestionSnapshotChunk {
  return { vehicles: [], observedVins: [], checkpointState: state };
}

/** The HTTP status of a Blob read that may succeed later: throttled (429) or
 * a server failure (5xx). The SDK reports a failed read only in its message. */
function retryableBlobReadStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const match = /Failed to fetch blob: (\d{3})\b/.exec(error.message);
  const status = match ? Number(match[1]) : null;
  return status !== null && (status === 429 || status >= 500) ? status : null;
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
  /** Whether a pathname holds checkpoint state alone rather than inventory. */
  isCheckpointStatePath(pathname: string): boolean {
    return CHECKPOINT_STATE_PATH.test(pathname);
  },

  /** Private Vercel Blob store, authorized by BLOB_READ_WRITE_TOKEN. */
  vercelBlob(
    token: string,
    client: { del: typeof del; get: typeof get; put: typeof put } = {
      del,
      get,
      put,
    },
    sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ): IngestionSnapshotStore {
    const putBlob = async (pathname: string, chunk: IngestionSnapshotChunk) =>
      (
        await client.put(pathname, encode(chunk), {
          access: "private",
          addRandomSuffix: true,
          contentType: "application/gzip",
          token,
        })
      ).pathname;
    // A long reconciliation reads hundreds of chunks in a row, and the store
    // throttles bursts with 429. Back off instead of failing the step.
    const getBlob = async (pathname: string) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await client.get(pathname, {
            access: "private",
            useCache: false,
            token,
          });
        } catch (error) {
          const status = retryableBlobReadStatus(error);
          const delay = BLOB_READ_RETRY_DELAYS_MS[attempt];
          if (status === null) throw error;
          if (delay === undefined)
            throw new Error(
              `Ingestion snapshot chunk ${pathname} could not be read from Blob storage: HTTP ${status} after ${attempt + 1} attempts over ${BLOB_READ_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0) / 1_000} s. The staged chunk and its run are preserved; retry the step once the Blob store recovers.`,
              { cause: error },
            );
          await sleep(delay);
        }
      }
    };
    return {
      put: ({ runId, source, chunk }) =>
        putBlob(`${BLOB_PREFIX}/${runId}/${source}/chunk.json.gz`, chunk),
      putCheckpointState: ({ runId, source, state }) =>
        putBlob(
          `${BLOB_PREFIX}/${runId}/${source}/${CHECKPOINT_STATE_FOLDER}/state.json.gz`,
          checkpointStateChunk(state),
        ),
      async load(pathname) {
        const result = await getBlob(pathname);
        if (!result || result.statusCode !== 200) {
          // A duplicate step attempt can still hold the cursor of a state that
          // a newer checkpoint replaced and deleted.
          if (IngestionSnapshotStore.isCheckpointStatePath(pathname))
            throw new Error(
              `Checkpoint state ${pathname} is missing from Blob storage, most likely because a newer checkpoint of the same source run replaced it. Saved checkpoints and published inventory are unaffected; retrying the step resumes from the latest checkpoint. If retries keep failing here, restart the run.`,
            );
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
        for (
          let start = 0;
          start < pathnames.length;
          start += BLOB_DELETE_BATCH_SIZE
        ) {
          await client.del(
            pathnames.slice(start, start + BLOB_DELETE_BATCH_SIZE),
            { token },
          );
        }
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
      async putCheckpointState({ runId, source, state }) {
        const pathname = `${BLOB_PREFIX}/${runId}/${source}/${CHECKPOINT_STATE_FOLDER}/${crypto.randomUUID()}.json.gz`;
        blobs.set(pathname, encode(checkpointStateChunk(state)));
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
