import { z } from "zod";
import { Effect } from "effect";
import {
  ArioRateLimit,
  ArioYardsSchema,
  createArioClient,
  type ArioBatchClient,
  type ArioClient,
} from "./autorecycler-ario-client";
import { ArioPageSchema } from "./autorecycler-ario-inventory";
import { ARIO_CUSTOMER_YARDS } from "./autorecycler-ario-yards";
import type { AutorecyclerCursor } from "./autorecycler-cursor";
import type { ConnectorChunkResult } from "./connector-chunk";
import { AutorecyclerProviderError } from "./errors";

const MAX_CONSECUTIVE_RATE_LIMITS = 24;
const StateSchema = z.object({
  consecutiveRateLimits: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_CONSECUTIVE_RATE_LIMITS)
    .optional(),
  session: z.object({
    key: z.string().optional(),
    bundle: z.string().optional(),
    lastFinished: z.number().nonnegative().optional(),
    requestTimes: z.array(z.number().nonnegative()).max(48).optional(),
    requests: z.number().int().nonnegative().optional(),
  }),
  directory: ArioYardsSchema.optional(),
  pages: z.record(z.record(ArioPageSchema)),
});
export type ArioRunState = z.infer<typeof StateSchema>;
type ReadCursor = Extract<AutorecyclerCursor, { phase: "ario-read" }>;
export type LoadArioState = (path: string) => Promise<unknown>;

export async function loadArioState(path: string, load?: LoadArioState) {
  if (!load)
    throw new Error("Ario resume requires the run's private checkpoint store");
  return StateSchema.parse(await load(path));
}

/** One multi-yard rank window per durable checkpoint. Payloads and the public
 * session key live in private snapshot storage, never in logged cursors. */
export function readArioRun(
  cursor: ReadCursor,
  load?: LoadArioState,
  makeClient: (state: ArioRunState) => ArioBatchClient = (state) =>
    createArioClient(state.session),
) {
  return Effect.tryPromise({
    try: async (): Promise<
      ConnectorChunkResult<"autorecycler", AutorecyclerCursor>
    > => {
      const state = cursor.statePath
        ? await loadArioState(cursor.statePath, load)
        : ({ session: {}, pages: {} } satisfies ArioRunState);
      const client = makeClient(state);
      let next: AutorecyclerCursor;
      let pagesProcessed = 0;
      try {
        state.directory ??= ArioYardsSchema.parse(await client.yards());
        const slugs: string[] = ARIO_CUSTOMER_YARDS.filter(
          (yard) =>
            cursor.closing ||
            cursor.offset === 0 ||
            (state.pages[yard.slug]?.["0"]?.total ?? 0) > cursor.offset,
        ).map((yard) => yard.slug);
        const raw = await client.pages(
          slugs,
          cursor.closing ? 0 : cursor.offset,
        );
        const group = ArioPageSchema.extend({
          items: ArioPageSchema.shape.items.max(
            ARIO_CUSTOMER_YARDS.length * 100,
          ),
          yards_meta: ArioPageSchema.shape.yards_meta.max(
            ARIO_CUSTOMER_YARDS.length,
          ),
        }).parse(raw);
        if (
          group.yards_meta.length !== slugs.length ||
          new Set(group.yards_meta.map((meta) => meta.yard)).size !==
            slugs.length ||
          group.items.some((item) => !slugs.includes(item.yard))
        )
          throw new Error(
            "Ario grouped search returned missing, duplicate or unexpected yards",
          );
        for (const slug of slugs) {
          const meta = group.yards_meta.find((entry) => entry.yard === slug);
          if (!meta) throw new Error(`Ario grouped search omitted ${slug}`);
          const items = group.items.filter((item) => item.yard === slug);
          const page = ArioPageSchema.parse({
            items,
            total: meta.total_matching,
            yards_meta: [meta],
          });
          const opening = state.pages[slug]?.["0"];
          const config = ARIO_CUSTOMER_YARDS.find((yard) => yard.slug === slug);
          let previousRank = cursor.closing ? 0 : cursor.offset;
          for (const item of items) {
            if (
              item.yard_id !== config?.id ||
              item.item_rank <= previousRank ||
              item.item_rank > (cursor.closing ? 0 : cursor.offset) + 100 ||
              item.total_yard_inventory !== page.total
            )
              throw new Error(
                `Ario ${slug} returned contradictory ownership or ranks`,
              );
            previousRank = item.item_rank;
          }
          if (
            meta.returned !== items.length ||
            page.total > 100_000 ||
            (opening && opening.total !== page.total) ||
            (cursor.closing &&
              JSON.stringify(opening?.items) !== JSON.stringify(items))
          )
            throw new Error(
              `Ario ${slug} changed during enumeration; restart the run before reconciliation`,
            );
          const saved = (state.pages[slug] ??= {});
          saved[cursor.closing ? "closing" : String(cursor.offset)] = page;
        }
        pagesProcessed = 1;
        state.consecutiveRateLimits = 0;
        const offset = cursor.offset + 100;
        next = cursor.closing
          ? {
              source: "autorecycler",
              phase: "ario",
              yardIndex: 0,
              freshness: cursor.freshness,
            }
          : {
              ...cursor,
              offset,
              closing: ARIO_CUSTOMER_YARDS.every(
                (yard) =>
                  (state.pages[yard.slug]?.["0"]?.total ?? Infinity) <= offset,
              ),
              retryAt: undefined,
            };
      } catch (error) {
        if (!(error instanceof ArioRateLimit)) throw error;
        state.consecutiveRateLimits = (state.consecutiveRateLimits ?? 0) + 1;
        // Default one-hour waits allow roughly a day of provider recovery.
        // A completed rank window resets the limit; restarts retain it in state.
        if (state.consecutiveRateLimits >= MAX_CONSECUTIVE_RATE_LIMITS)
          throw new Error(
            `Ario stopped after ${MAX_CONSECUTIVE_RATE_LIMITS} consecutive rate-limit pauses at rank offset ${cursor.offset}. Published inventory is preserved. Inspect the provider quota and shared-IP traffic before starting a new ingestion run.`,
          );
        next = { ...cursor, retryAt: error.retryAt };
      }
      return {
        source: "autorecycler",
        status: "paused",
        cursor: next,
        checkpointState: state,
        count: 0,
        errors: [],
        pagesProcessed,
      };
    },
    catch: (cause) =>
      new AutorecyclerProviderError({ from: cursor.offset, cause }),
  });
}

/** Replay the completed private capture through the same per-yard validator and
 * transformer used by offline fixtures. Publishing performs no provider calls. */
export function arioReplayClient(state: ArioRunState): ArioClient {
  const opened = new Set<string>();
  return {
    yards: async () => state.directory,
    page: async (slug, offset) => {
      const key = offset === 0 && opened.has(slug) ? "closing" : String(offset);
      if (offset === 0) opened.add(slug);
      const page = state.pages[slug]?.[key];
      if (!page)
        throw new Error(`Ario checkpoint omitted ${slug} window ${key}`);
      return page;
    },
  };
}
