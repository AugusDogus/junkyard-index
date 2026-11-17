import { parseRetryAfterMs } from "./provider-http-client";
import { z } from "zod";

export const ARIO_ORIGIN = "https://ario.autorecycler.io";
const ARIO_API = "https://zqfzqcyteuemzbnwtmcr.supabase.co";

/** The publishable browser key is discovered from Ario's current public bundle.
 * It grants the same anonymous inventory access as the yard embed. */
export class ArioRateLimit extends Error {
  constructor(readonly retryAt: number) {
    super(
      "Ario hourly inventory limit reached; resume the checkpoint after the provider wait",
    );
  }
}

export const ARIO_HOURLY_REQUEST_BUDGET = 48;
export interface ArioSession {
  key?: string;
  bundle?: string;
  lastFinished?: number;
  requestTimes?: number[];
  requests?: number;
}
export function createArioClient(
  session: ArioSession = {},
  fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch,
) {
  const request = async (url: string, init: RequestInit = {}) => {
    const now = Date.now();
    session.requestTimes = (session.requestTimes ?? []).filter(
      (time) => now < time + 3_601_000,
    );
    const oldest = session.requestTimes[0];
    if (
      session.requestTimes.length >= ARIO_HOURLY_REQUEST_BUDGET &&
      oldest !== undefined
    )
      throw new ArioRateLimit(oldest + 3_601_000);
    const wait = Math.max(0, (session.lastFinished ?? 0) + 2_200 - now);
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      session.requestTimes.push(Date.now());
      session.requests = (session.requests ?? 0) + 1;
      const response = await fetcher(url, {
        ...init,
        signal: AbortSignal.timeout(45_000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
          Accept: "application/json",
          Origin: ARIO_ORIGIN,
          Referer: `${ARIO_ORIGIN}/`,
          ...init.headers,
        },
      });
      if (response.status === 429) {
        const now = Date.now();
        const delay = parseRetryAfterMs(
          response.headers.get("retry-after"),
          now,
        );
        if (!Number.isFinite(delay))
          throw new Error("Ario returned an unrepresentable Retry-After delay");
        throw new ArioRateLimit(now + (delay > 0 ? delay : 3_600_000));
      }
      if (!response.ok)
        throw new Error(
          `Ario ${new URL(url).pathname} returned HTTP ${response.status}. Retry the source after checking the public inventory; published data is preserved.`,
        );
      return response;
    } finally {
      session.lastFinished = Date.now();
    }
  };
  const publishableKey = async () => {
    if (session.key) return session.key;
    if (!session.bundle) {
      const html = await (await request(ARIO_ORIGIN)).text();
      const script = /<script\b[^>]*\bsrc="(\/assets\/index-[\w-]+\.js)"/.exec(
        html,
      )?.[1];
      if (!script)
        throw new Error(
          "Ario's public inventory bundle was not found. Inspect the yard embed before retrying.",
        );
      session.bundle = script;
    }
    const bundle = await (
      await request(`${ARIO_ORIGIN}${session.bundle}`)
    ).text();
    const discovered = /"(sb_publishable_[A-Za-z0-9_-]+)"/.exec(bundle)?.[1];
    if (!discovered)
      throw new Error(
        "Ario's public publishable key was not found in its inventory bundle. Inspect the updated embed before retrying.",
      );
    session.key = discovered;
    return discovered;
  };
  const json = async (path: string, body?: unknown): Promise<unknown> => {
    const apikey = await publishableKey();
    return (
      await request(`${ARIO_API}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { apikey, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    ).json();
  };
  const pages = (slugs: readonly string[], offset: number) =>
    json("/functions/v1/search-inventory", {
      yard_list: slugs,
      per_yard_limit: 100,
      item_rank_offset: offset,
      start_year: null,
      end_year: null,
      input_make: null,
      input_model: null,
    });
  return {
    pages,
    yards: () =>
      json(
        "/rest/v1/yards?select=id,slug,display_name,organization_id,address,city,state,website_url,phone,data&customer_facing_visible=eq.true",
      ),
    page: (slug: string, offset: number) => pages([slug], offset),
  };
}

export type ArioClient = Pick<
  ReturnType<typeof createArioClient>,
  "yards" | "page"
>;
export type ArioBatchClient = Pick<
  ReturnType<typeof createArioClient>,
  "yards" | "pages"
>;

export const ArioYardsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    slug: z.string().nullable(),
    display_name: z.string().trim().min(1).nullable(),
    organization_id: z.string().uuid().nullable(),
    address: z.string().nullish(),
    website_url: z.string().nullish(),
    phone: z.string().nullish(),
    data: z.object({
      source: z.string().optional(),
      crush_client_id: z.string().optional(),
      latitude: z.number().finite().min(-90).max(90).optional(),
      longitude: z.number().finite().min(-180).max(180).optional(),
      mapCenter: z
        .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
        .optional(),
    }),
  }),
);
