import { gunzipSync, gzipSync } from "node:zlib";
import { BlobServiceRateLimited, del, get, put } from "@vercel/blob";
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
  delete(
    pathnames: readonly string[],
    policy: SnapshotDeletePolicy,
  ): Promise<void>;
}

/**
 * How a delete spends time.
 * - best-effort: a checkpoint freeing a blob in the middle of a crawl step.
 *   One unpaced attempt, abandoned after {@link BEST_EFFORT_DELETE_TIMEOUT_MS};
 *   a failure is the caller's to log, never a reason to stall the step.
 * - paced: cleanup. Batches are paced to 1,000 URLs a minute and rate limits
 *   are waited out, but no wait or request runs past `deadline` (by the
 *   store's clock); reaching it throws {@link SnapshotDeleteDeadlineError}.
 */
export type SnapshotDeletePolicy =
  | { kind: "best-effort" }
  | { kind: "paced"; deadline: number };

/**
 * A paced delete that stopped at its deadline. The batches before it are
 * deleted; the rest may still be in Blob storage and are still registered.
 */
export class SnapshotDeleteDeadlineError extends Error {
  readonly _tag = "SnapshotDeleteDeadlineError";

  constructor(
    readonly deleted: number,
    readonly remaining: number,
  ) {
    super(
      `Stopped deleting staged snapshot blobs at the cleanup deadline: ${deleted} of ${deleted + remaining} were deleted; the other ${remaining} are still registered, so the next cleanup deletes them. Published inventory is unaffected.`,
    );
    this.name = "SnapshotDeleteDeadlineError";
  }
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
// Vercel Blob rejects a delete of more than 1,000 URLs, and counts each URL
// toward its operation rate limit. One 1,000-URL delete followed at once by
// another was rate limited for 60 s, so cleanup deletes go in small batches
// paced to 1,000 a minute. The pace is shared by every store in the process;
// other instances keep their own, and a rate limit they cause is waited out.
const BLOB_DELETE_BATCH_SIZE = 250;
const BLOB_DELETE_INTERVAL_MS_PER_URL = 60;
/** Least waits between attempts of a rate-limited cleanup delete; each waits
 * at least as long as the store asks. The SDK itself already retries 5xx and
 * unknown errors 10 times, so only rate limits are retried here. */
const BLOB_DELETE_RETRY_DELAYS_MS = [
  5_000, 15_000, 30_000, 60_000, 60_000,
] as const;
/** The longest Retry-After a cleanup delete honours; the deadline bounds it. */
const BLOB_DELETE_MAX_RETRY_AFTER_MS = 120_000;
/** How long a checkpoint waits for a best-effort delete. The SDK's own 5xx
 * retries sleep 1, 2, 4 s and on, so this allows a few of them. */
export const BEST_EFFORT_DELETE_TIMEOUT_MS = 10_000;
// setTimeout fires at once for anything longer.
const MAX_TIMER_MS = 2_147_483_647;
// Chunks are immutable under unique pathnames, so the process keeps the
// latest ones it staged or read. A crawl step reads the checkpoint state the
// previous step staged (Hollander's is about 2.9 MB gzipped), and
// reconciliation reads what validation read; on a reused instance those
// reads cost no Blob transfer. A delete evicts only this process's copy: an
// instance that cached a chunk another instance deleted still serves it.
// That is safe because nothing reads a chunk after deleting it on purpose:
// cleanup deletes only runs that are no longer active, and a superseded
// checkpoint state is read again only by a replayed step, which gets the
// newer checkpoint from getCheckpoint before it loads any state.
const CHUNK_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const CHUNK_CACHE_MAX_ENTRY_BYTES = 16 * 1024 * 1024;

type BlobClient = { del: typeof del; get: typeof get; put: typeof put };

/** Process-wide state of one Blob client: shared by every store using it. */
type BlobClientState = {
  /** Gzipped chunks by pathname, least recently used first. */
  chunks: Map<string, Uint8Array>;
  chunkBytes: number;
  /** When the next delete batch may start, by the store's clock. */
  nextDeleteAt: number;
};

const DEFAULT_BLOB_CLIENT: BlobClient = { del, get, put };
const blobClientStates = new WeakMap<BlobClient, BlobClientState>();

function blobClientState(client: BlobClient): BlobClientState {
  let state = blobClientStates.get(client);
  if (!state) {
    state = { chunks: new Map(), chunkBytes: 0, nextDeleteAt: 0 };
    blobClientStates.set(client, state);
  }
  return state;
}

function cacheChunk(
  state: BlobClientState,
  pathname: string,
  body: Uint8Array,
): void {
  uncacheChunk(state, pathname);
  if (body.byteLength > CHUNK_CACHE_MAX_ENTRY_BYTES) return;
  state.chunks.set(pathname, body);
  state.chunkBytes += body.byteLength;
  for (const [oldest, oldestBody] of state.chunks) {
    if (state.chunkBytes <= CHUNK_CACHE_MAX_BYTES) break;
    state.chunks.delete(oldest);
    state.chunkBytes -= oldestBody.byteLength;
  }
}

function cachedChunk(
  state: BlobClientState,
  pathname: string,
): Uint8Array | undefined {
  const body = state.chunks.get(pathname);
  if (body === undefined) return undefined;
  // Most recently used last.
  state.chunks.delete(pathname);
  state.chunks.set(pathname, body);
  return body;
}

function uncacheChunk(state: BlobClientState, pathname: string): void {
  const body = state.chunks.get(pathname);
  if (body === undefined) return;
  state.chunks.delete(pathname);
  state.chunkBytes -= body.byteLength;
}

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

/**
 * How long a rate-limited delete is asked to wait, or null for any other
 * error. The SDK parses Retry-After with parseInt, so a missing header gives
 * 0 and an HTTP date gives NaN; both fall back to the backoff floor.
 */
function rateLimitWaitMs(error: unknown): number | null {
  if (!(error instanceof BlobServiceRateLimited)) return null;
  const seconds = error.retryAfter;
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1_000, BLOB_DELETE_MAX_RETRY_AFTER_MS)
    : 0;
}

/**
 * Runs one Blob request with an abort signal and settles by `ms` at the
 * latest. The SDK sleeps between its own retries, which an abort does not
 * cut short, so the race, not the signal, bounds the wait. A request still
 * running then is aborted and its outcome ignored.
 */
async function withinMs(
  run: (abortSignal: AbortSignal) => Promise<void>,
  ms: number,
): Promise<"done" | "timed-out"> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timed-out">((resolve) => {
    timer = setTimeout(
      () => {
        controller.abort();
        resolve("timed-out");
      },
      Math.min(Math.max(ms, 0), MAX_TIMER_MS),
    );
  });
  const request = run(controller.signal).then(() => "done" as const);
  try {
    return await Promise.race([request, timedOut]);
  } finally {
    clearTimeout(timer);
    request.catch(() => {});
  }
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

  /**
   * Private Vercel Blob store, authorized by BLOB_READ_WRITE_TOKEN. Stores
   * on the same client share a process cache of recent chunks and the pace
   * of deletes.
   */
  vercelBlob(
    token: string,
    client: BlobClient = DEFAULT_BLOB_CLIENT,
    sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => number = Date.now,
  ): IngestionSnapshotStore {
    const shared = blobClientState(client);
    const cacheKey = (pathname: string) => `${token}\n${pathname}`;
    const putBlob = async (pathname: string, chunk: IngestionSnapshotChunk) => {
      const body = encode(chunk);
      const stored = (
        await client.put(pathname, body, {
          access: "private",
          addRandomSuffix: true,
          contentType: "application/gzip",
          token,
        })
      ).pathname;
      cacheChunk(shared, cacheKey(stored), body);
      return stored;
    };
    const deleteOnce = (batch: string[], ms: number) =>
      withinMs((abortSignal) => client.del(batch, { token, abortSignal }), ms);
    const deleteBestEffort = async (batch: string[]) => {
      // Counts toward the pace, but never waits for it.
      shared.nextDeleteAt = Math.max(
        shared.nextDeleteAt,
        now() + batch.length * BLOB_DELETE_INTERVAL_MS_PER_URL,
      );
      if (
        (await deleteOnce(batch, BEST_EFFORT_DELETE_TIMEOUT_MS)) === "timed-out"
      )
        throw new Error(
          `Vercel Blob did not finish deleting ${batch.length} snapshot blobs within ${BEST_EFFORT_DELETE_TIMEOUT_MS / 1_000} s, so the request was abandoned; they may still be in Blob storage.`,
        );
    };
    const deletePaced = async (
      batch: string[],
      deadline: number,
      deletedBefore: number,
      total: number,
    ) => {
      const stop = () =>
        new SnapshotDeleteDeadlineError(deletedBefore, total - deletedBefore);
      // Reserve this batch's slot before waiting, so concurrent deletes in
      // this process queue behind one another instead of waking together.
      const startAt = Math.max(shared.nextDeleteAt, now());
      shared.nextDeleteAt =
        startAt + batch.length * BLOB_DELETE_INTERVAL_MS_PER_URL;
      if (startAt >= deadline) throw stop();
      if (startAt > now()) await sleep(startAt - now());
      for (let attempt = 0; ; attempt += 1) {
        let outcome: "done" | "timed-out";
        try {
          outcome = await deleteOnce(batch, deadline - now());
        } catch (error) {
          const asked = rateLimitWaitMs(error);
          if (asked === null) throw error;
          const floor = BLOB_DELETE_RETRY_DELAYS_MS[attempt];
          if (floor === undefined)
            throw new Error(
              `Could not delete ${total - deletedBefore} staged snapshot blobs: Vercel Blob was still rate limiting after ${attempt + 1} attempts. ${deletedBefore} of ${total} were deleted; the other ${total - deletedBefore} are still in Blob storage and still registered, so the next cleanup retries them. Published inventory is unaffected.`,
              { cause: error },
            );
          const wait = Math.max(floor, asked);
          if (now() + wait >= deadline) throw stop();
          await sleep(wait);
          continue;
        }
        if (outcome === "timed-out") throw stop();
        return;
      }
    };
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
        const cached = cachedChunk(shared, cacheKey(pathname));
        if (cached !== undefined) return decode(pathname, cached);
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
        const chunk = decode(pathname, body);
        cacheChunk(shared, cacheKey(pathname), body);
        return chunk;
      },
      async delete(pathnames, policy) {
        for (const pathname of pathnames)
          uncacheChunk(shared, cacheKey(pathname));
        for (
          let start = 0;
          start < pathnames.length;
          start += BLOB_DELETE_BATCH_SIZE
        ) {
          const batch = pathnames.slice(start, start + BLOB_DELETE_BATCH_SIZE);
          if (policy.kind === "best-effort") await deleteBestEffort(batch);
          else
            await deletePaced(batch, policy.deadline, start, pathnames.length);
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
