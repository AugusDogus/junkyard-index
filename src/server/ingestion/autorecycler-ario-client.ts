import { z } from "zod";

export const ARIO_ORIGIN = "https://ario.autorecycler.io";
const ARIO_API = "https://zqfzqcyteuemzbnwtmcr.supabase.co";

/** The publishable browser key is discovered from Ario's current public bundle.
 * It grants the same anonymous inventory access as the yard embed. */
export function createArioClient() {
  let key: string | undefined;
  let lastFinished = 0;
  const request = async (url: string, init: RequestInit = {}) => {
    const wait = Math.max(0, lastFinished + 2_200 - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      const response = await fetch(url, {
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
      if (!response.ok)
        throw new Error(
          `Ario ${new URL(url).pathname} returned HTTP ${response.status}. Retry the source after checking the public inventory; published data is preserved.`,
        );
      return response;
    } finally {
      lastFinished = Date.now();
    }
  };
  const publishableKey = async () => {
    if (key) return key;
    const html = await (await request(ARIO_ORIGIN)).text();
    const script = /<script\b[^>]*\bsrc="(\/assets\/index-[\w-]+\.js)"/.exec(
      html,
    )?.[1];
    if (!script)
      throw new Error(
        "Ario's public inventory bundle was not found. Inspect the yard embed before retrying.",
      );
    const bundle = await (await request(`${ARIO_ORIGIN}${script}`)).text();
    const discovered = /"(sb_publishable_[A-Za-z0-9_-]+)"/.exec(bundle)?.[1];
    if (!discovered)
      throw new Error(
        "Ario's public publishable key was not found in its inventory bundle. Inspect the updated embed before retrying.",
      );
    key = discovered;
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
  return {
    yards: () =>
      json(
        "/rest/v1/yards?select=id,slug,display_name,organization_id,address,city,state,website_url,phone,data&customer_facing_visible=eq.true",
      ),
    page: (slug: string, offset: number) =>
      json("/functions/v1/search-inventory", {
        yard_list: [slug],
        per_yard_limit: 100,
        item_rank_offset: offset,
        start_year: null,
        end_year: null,
        input_make: null,
        input_model: null,
      }),
  };
}

export type ArioClient = ReturnType<typeof createArioClient>;

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
      latitude: z.number().finite().min(-90).max(90).optional(),
      longitude: z.number().finite().min(-180).max(180).optional(),
      mapCenter: z
        .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
        .optional(),
    }),
  }),
);
