import {
  AUTORECYCLER_BUBBLE_APP_NAME,
  encryptBubbleObfuscatedBody,
} from "./autorecycler-bubble-obfuscate";
import msearchTemplate from "./fixtures/msearch-inventory-page-template.json";

export const AUTORECYCLER_ORIGIN = "https://app.autorecycler.io";

const MSSEARCH_PATH = "/elasticsearch/msearch";
const FETCH_TIMEOUT_MS = 45_000;
const MAX_RETRIES = 4;
const RETRY_BASE_MS = 400;

export type AutorecyclerMsearchInner = {
  appname: string;
  app_version: string;
  searches: Array<Record<string, unknown>>;
};

export type AutorecyclerMsearchHit = {
  _source?: Record<string, unknown>;
};

export type AutorecyclerMsearchResponse = {
  responses?: Array<{
    hits?: { hits?: AutorecyclerMsearchHit[]; total?: number | string };
    at_end?: boolean;
  }>;
};

export type AutorecyclerInitDataRow = {
  type?: string;
  data?: Record<string, unknown>;
};

export function getGlobalMsearchTemplate(): AutorecyclerMsearchInner {
  return structuredClone(msearchTemplate) as AutorecyclerMsearchInner;
}

/** Template without per-org constraint (global inventory index). */
export function buildGlobalMsearchBody(
  from: number,
  pageSize: number,
): AutorecyclerMsearchInner {
  const inner = getGlobalMsearchTemplate();
  const search = inner.searches[0] as {
    constraints?: Array<{ key?: string }>;
    from?: number;
    n?: number;
  };
  if (!search?.constraints) {
    throw new Error("autorecycler: msearch template missing constraints");
  }
  search.constraints = search.constraints.filter(
    (c) => c.key !== "organization_custom_organization",
  );
  search.from = from;
  search.n = pageSize;
  return inner;
}

export function buildWebsiteLookupMsearchBody(
  orgLookup: string,
): AutorecyclerMsearchInner {
  const inner = getGlobalMsearchTemplate();
  const search = inner.searches[0] as {
    type?: string;
    constraints?: Array<Record<string, unknown>>;
    sorts_list?: Array<Record<string, unknown>>;
    from?: number;
    n?: number;
  };
  if (!search?.constraints) {
    throw new Error("autorecycler: msearch template missing constraints");
  }

  search.type = "custom.website";
  search.constraints = [
    {
      key: "organization_custom_organization",
      value: [orgLookup],
      constraint_type: "in",
    },
  ];
  search.sorts_list = [];
  search.from = 0;
  search.n = 1;
  return inner;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/** HTTP failure that must not trigger exponential backoff (e.g. 4xx other than rate limits). */
export class AutorecyclerNonRetryableHttpError extends Error {
  override readonly name = "AutorecyclerNonRetryableHttpError";
  readonly nonRetryable = true as const;
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isNonRetryableHttpClientError(
  e: unknown,
): e is AutorecyclerNonRetryableHttpError {
  return e instanceof AutorecyclerNonRetryableHttpError;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function postAutorecyclerElasticsearchMsearch(
  innerBody: AutorecyclerMsearchInner,
): Promise<AutorecyclerMsearchResponse> {
  const encrypted = encryptBubbleObfuscatedBody(innerBody, AUTORECYCLER_BUBBLE_APP_NAME, {
    timestampMs: Date.now(),
  });
  const url = `${AUTORECYCLER_ORIGIN}${MSSEARCH_PATH}`;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Origin: AUTORECYCLER_ORIGIN,
            Referer: `${AUTORECYCLER_ORIGIN}/buy`,
          },
          body: JSON.stringify(encrypted),
        },
        FETCH_TIMEOUT_MS,
      );

      if (isRetryableStatus(res.status) && attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        const msg = `msearch HTTP ${res.status}: ${text.slice(0, 500)}`;
        if (!isRetryableStatus(res.status)) {
          throw new AutorecyclerNonRetryableHttpError(msg, res.status);
        }
        throw new Error(msg);
      }

      const body = (await res.json()) as AutorecyclerMsearchResponse;
      return body;
    } catch (e) {
      if (isNonRetryableHttpClientError(e)) {
        throw e;
      }
      lastError = e;
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchAutorecyclerInitDataForUrl(
  pageUrl: string,
): Promise<AutorecyclerInitDataRow[]> {
  const location = encodeURIComponent(pageUrl);
  const url = `${AUTORECYCLER_ORIGIN}/api/1.1/init/data?location=${location}`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(
        url,
        { headers: { Accept: "application/json" } },
        FETCH_TIMEOUT_MS,
      );
      if (isRetryableStatus(res.status) && attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        const msg = `init/data HTTP ${res.status}: ${text.slice(0, 400)}`;
        if (!isRetryableStatus(res.status)) {
          throw new AutorecyclerNonRetryableHttpError(msg, res.status);
        }
        throw new Error(msg);
      }
      return (await res.json()) as AutorecyclerInitDataRow[];
    } catch (e) {
      if (isNonRetryableHttpClientError(e)) {
        throw e;
      }
      if (attempt === MAX_RETRIES - 1) {
        throw e instanceof Error ? e : new Error(String(e));
      }
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
    }
  }

  return [];
}

export async function fetchAutorecyclerDetailsInitData(inventoryId: string) {
  return fetchAutorecyclerInitDataForUrl(
    `${AUTORECYCLER_ORIGIN}/details/${inventoryId}`,
  );
}
