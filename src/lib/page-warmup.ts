/** How a page is requested; tests pass a fake. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type PageWarmupResult = { warmed: number; failed: number };

// Few at a time: each request can start a page regeneration.
const CONCURRENCY = 4;

/**
 * Requesting a page whose cache tag was revalidated serves the old copy and
 * regenerates it in the background. Doing that before announcing the page
 * means a crawler that follows the announcement gets the new copy.
 */
export const PageWarmup = {
  async run(
    origin: string,
    paths: readonly string[],
    send: Fetch = fetch,
  ): Promise<PageWarmupResult> {
    const urls = [...new Set(paths)].map((path) =>
      new URL(path, origin).toString(),
    );
    let next = 0;
    let warmed = 0;
    let failed = 0;
    const worker = async () => {
      for (let url = urls[next++]; url !== undefined; url = urls[next++]) {
        try {
          const response = await send(url, {
            headers: { "user-agent": "JunkyardIndex-PageWarmup" },
            signal: AbortSignal.timeout(30_000),
          });
          await response.body?.cancel();
          if (response.ok) warmed++;
          else failed++;
        } catch {
          failed++;
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return { warmed, failed };
  },
} as const;
