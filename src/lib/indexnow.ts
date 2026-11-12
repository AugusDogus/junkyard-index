/**
 * IndexNow tells Bing, Yandex, Seznam, Naver, and other participating engines
 * which URLs changed, so they recrawl them without waiting for the sitemap.
 * The key proves we own the host; it is public by design and served at
 * /{INDEXNOW_KEY}.txt.
 */
export const INDEXNOW_KEY = "8b7f8b53cf4535682f76fcef1d956fb3";

const ENDPOINT = "https://api.indexnow.org/indexnow";

// The protocol accepts at most 10,000 URLs per request.
const MAX_URLS = 10_000;

/** How a submission is sent; tests pass a fake. */
export type Send = (url: string, init: RequestInit) => Promise<Response>;

export type IndexNowSubmission =
  | { status: "submitted"; urls: number }
  | { status: "skipped"; reason: string }
  | { status: "failed"; urls: number; httpStatus: number; detail: string };

export const IndexNow = {
  endpoint: ENDPOINT,

  /** Request bodies for these paths, at most 10,000 absolute URLs each. */
  payloads(origin: string, paths: readonly string[]) {
    const host = new URL(origin).host;
    const urls = [...new Set(paths)].map((path) =>
      new URL(path, origin).toString(),
    );
    const bodies = [];
    for (let start = 0; start < urls.length; start += MAX_URLS) {
      bodies.push({
        host,
        key: INDEXNOW_KEY,
        keyLocation: new URL(`/${INDEXNOW_KEY}.txt`, origin).toString(),
        urlList: urls.slice(start, start + MAX_URLS),
      });
    }
    return bodies;
  },

  /**
   * Submits the paths. 200 and 202 (key check pending) both count as
   * submitted; anything else stops, since the sitemap still covers the rest.
   */
  async submit(
    origin: string,
    paths: readonly string[],
    send: Send = fetch,
  ): Promise<IndexNowSubmission> {
    const payloads = IndexNow.payloads(origin, paths);
    if (payloads.length === 0) {
      return { status: "skipped", reason: "no changed URLs" };
    }
    let urls = 0;
    for (const payload of payloads) {
      const response = await send(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status !== 200 && response.status !== 202) {
        return {
          status: "failed",
          urls: payload.urlList.length,
          httpStatus: response.status,
          detail: (await response.text()).slice(0, 300),
        };
      }
      urls += payload.urlList.length;
    }
    return { status: "submitted", urls };
  },
} as const;
