import { Hyperbrowser } from "@hyperbrowser/sdk";
import { chromium, type Browser } from "playwright-core";
import { sleep } from "workflow";

const DAVIE_ORIGIN = "https://upullitdavie.com";
const DAVIE_INVENTORY_URL = `${DAVIE_ORIGIN}/inventory`;
const DAVIE_API_URL = `${DAVIE_ORIGIN}/api/inventory/search?page=1`;
const PROBE_INTERVAL = "5 seconds";
const REQUEST_TIMEOUT_MS = 30_000;
const BROWSER_TIMEOUT_MS = 60_000;
const BODY_SAMPLE_LENGTH = 160;
const HYPERBROWSER_REGION = "us-west" as const;
const REQUEST_HEADERS = {
  Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
  Referer: DAVIE_INVENTORY_URL,
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
} as const;
const BROWSER_REQUEST_HEADERS = { Accept: REQUEST_HEADERS.Accept } as const;

type ProbeHeaders = {
  cfMitigated: string | null;
  cfRay: string | null;
  contentType: string | null;
  retryAfter: string | null;
  server: string | null;
};

type ProbeBody =
  | {
      kind: "davie-json";
      bytes: number;
      page: number | null;
      totalCount: number | null;
      totalPages: number | null;
      vehicleCount: number | null;
    }
  | { kind: "other"; bytes: number; sample: string | null };

type ProbeObservation = {
  body: ProbeBody;
  durationMs: number;
  headers: ProbeHeaders;
  httpStatus: number;
  ok: boolean;
  vercelRegion: string | null;
};

type BootstrapObservation = {
  cookieNames: string[];
  durationMs: number;
  httpStatus: number;
};

type ProbeResult =
  | {
      technique: "direct";
      outcome: "response";
      response: ProbeObservation;
    }
  | {
      technique: "cookie-bootstrap";
      outcome: "response";
      bootstrap: BootstrapObservation;
      response: ProbeObservation;
    }
  | {
      technique: "hyperbrowser";
      outcome: "response";
      requestSource: "inventory-page" | "explicit-fetch";
      response: ProbeObservation;
      sessionId: string;
    }
  | {
      technique: "direct" | "cookie-bootstrap" | "hyperbrowser";
      outcome: "error";
      message: string;
      vercelRegion: string | null;
    }
  | {
      technique: "hyperbrowser";
      outcome: "skipped";
      reason: string;
      vercelRegion: string | null;
    };

export type DavieProbeReport = {
  results: ProbeResult[];
};

type BrowserResponsePayload = {
  body: string;
  durationMs: number;
  headers: Record<string, string>;
  status: number;
};

function vercelRegion(): string | null {
  return process.env.VERCEL_REGION ?? null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberField(
  value: Record<string, unknown>,
  field: string,
): number | null {
  const candidate = value[field];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : null;
}

function summarizeBody(body: string): ProbeBody {
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed) && Array.isArray(parsed.vehicles)) {
      return {
        kind: "davie-json",
        bytes: body.length,
        page: numberField(parsed, "page"),
        totalCount: numberField(parsed, "totalCount"),
        totalPages: numberField(parsed, "totalPages"),
        vehicleCount: parsed.vehicles.length,
      };
    }
  } catch {
    // Non-JSON error bodies are summarized below without returning full HTML.
  }

  const sample = body.replace(/\s+/g, " ").trim().slice(0, BODY_SAMPLE_LENGTH);
  return {
    kind: "other",
    bytes: body.length,
    sample: sample.length > 0 ? sample : null,
  };
}

function summarizeResponse(
  status: number,
  headers: Headers,
  body: string,
  durationMs: number,
): ProbeObservation {
  return {
    body: summarizeBody(body),
    durationMs,
    headers: {
      cfMitigated: headers.get("cf-mitigated"),
      cfRay: headers.get("cf-ray"),
      contentType: headers.get("content-type"),
      retryAfter: headers.get("retry-after"),
      server: headers.get("server"),
    },
    httpStatus: status,
    ok: status >= 200 && status < 300,
    vercelRegion: vercelRegion(),
  };
}

function setCookieValues(headers: Headers): string[] {
  const method = Reflect.get(headers, "getSetCookie");
  if (typeof method === "function") {
    const result: unknown = Reflect.apply(method, headers, []);
    if (
      Array.isArray(result) &&
      result.every((value) => typeof value === "string")
    ) {
      return result;
    }
  }
  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

function cookiePairs(setCookies: string[]): string[] {
  return setCookies
    .map((value) => value.split(";", 1)[0]?.trim() ?? "")
    .filter((value) => value.includes("="));
}

function cookieNames(cookies: string[]): string[] {
  return cookies
    .map((cookie) => cookie.split("=", 1)[0]?.trim() ?? "")
    .filter((name) => name.length > 0);
}

async function requestDavie(headers: Record<string, string>) {
  const startedAt = Date.now();
  const response = await fetch(DAVIE_API_URL, {
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.text();
  return summarizeResponse(
    response.status,
    response.headers,
    body,
    Date.now() - startedAt,
  );
}

export async function probeDavieDirectStep(): Promise<ProbeResult> {
  "use step";

  try {
    return {
      technique: "direct",
      outcome: "response",
      response: await requestDavie(REQUEST_HEADERS),
    };
  } catch (error) {
    return {
      technique: "direct",
      outcome: "error",
      message: errorMessage(error),
      vercelRegion: vercelRegion(),
    };
  }
}
probeDavieDirectStep.maxRetries = 0;

export async function probeDavieCookieBootstrapStep(): Promise<ProbeResult> {
  "use step";

  try {
    const startedAt = Date.now();
    const bootstrap = await fetch(DAVIE_INVENTORY_URL, {
      cache: "no-store",
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const cookies = cookiePairs(setCookieValues(bootstrap.headers));
    await bootstrap.body?.cancel();
    const bootstrapDurationMs = Date.now() - startedAt;

    const response = await requestDavie({
      ...REQUEST_HEADERS,
      ...(cookies.length > 0 ? { Cookie: cookies.join("; ") } : {}),
    });
    return {
      technique: "cookie-bootstrap",
      outcome: "response",
      bootstrap: {
        cookieNames: cookieNames(cookies),
        durationMs: bootstrapDurationMs,
        httpStatus: bootstrap.status,
      },
      response,
    };
  } catch (error) {
    return {
      technique: "cookie-bootstrap",
      outcome: "error",
      message: errorMessage(error),
      vercelRegion: vercelRegion(),
    };
  }
}
probeDavieCookieBootstrapStep.maxRetries = 0;

function isDavieApiRequest(url: string): boolean {
  try {
    return new URL(url).pathname === "/api/inventory/search";
  } catch {
    return false;
  }
}

async function explicitBrowserFetch(page: import("playwright-core").Page) {
  return page.evaluate(
    async ({ apiUrl, headers }): Promise<BrowserResponsePayload> => {
      const startedAt = performance.now();
      const response = await fetch(apiUrl, {
        cache: "no-store",
        headers,
      });
      return {
        body: await response.text(),
        durationMs: Math.round(performance.now() - startedAt),
        headers: Object.fromEntries(response.headers.entries()),
        status: response.status,
      };
    },
    { apiUrl: DAVIE_API_URL, headers: BROWSER_REQUEST_HEADERS },
  );
}

async function closeBrowser(browser: Browser | null): Promise<void> {
  if (!browser) return;
  await browser.close().catch(() => undefined);
}

export async function probeDavieHyperbrowserStep(): Promise<ProbeResult> {
  "use step";

  const apiKey = process.env.HYPERBROWSER_API_KEY;
  if (!apiKey) {
    return {
      technique: "hyperbrowser",
      outcome: "skipped",
      reason: "HYPERBROWSER_API_KEY is not configured for this deployment",
      vercelRegion: vercelRegion(),
    };
  }

  const client = new Hyperbrowser({ apiKey });
  let browser: Browser | null = null;
  let sessionId: string | null = null;
  try {
    const session = await client.sessions.create({
      acceptCookies: true,
      region: HYPERBROWSER_REGION,
      timeoutMinutes: 5,
      useStealth: true,
    });
    sessionId = session.id;
    browser = await chromium.connectOverCDP(session.wsEndpoint, {
      timeout: BROWSER_TIMEOUT_MS,
    });
    const context =
      browser.contexts()[0] ??
      (await browser.newContext({ acceptDownloads: false }));
    const page = context.pages()[0] ?? (await context.newPage());
    let observedApiResponse: Promise<BrowserResponsePayload> | null = null;

    page.on("response", (response) => {
      if (observedApiResponse || !isDavieApiRequest(response.url())) return;
      const startedAt = Date.now();
      observedApiResponse = Promise.all([
        response.text(),
        response.allHeaders(),
      ]).then(([body, headers]) => ({
        body,
        durationMs: Date.now() - startedAt,
        headers,
        status: response.status(),
      }));
    });

    await page.goto(DAVIE_INVENTORY_URL, {
      timeout: BROWSER_TIMEOUT_MS,
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(5_000);
    const capturedResponse = observedApiResponse;
    const payload = capturedResponse
      ? await capturedResponse
      : await explicitBrowserFetch(page);
    const requestSource = capturedResponse
      ? "inventory-page"
      : "explicit-fetch";

    return {
      technique: "hyperbrowser",
      outcome: "response",
      requestSource,
      response: summarizeResponse(
        payload.status,
        new Headers(payload.headers),
        payload.body,
        payload.durationMs,
      ),
      sessionId,
    };
  } catch (error) {
    return {
      technique: "hyperbrowser",
      outcome: "error",
      message: errorMessage(error),
      vercelRegion: vercelRegion(),
    };
  } finally {
    await closeBrowser(browser);
    if (sessionId) {
      await client.sessions.stop(sessionId).catch(() => undefined);
    }
  }
}
probeDavieHyperbrowserStep.maxRetries = 0;

export async function davieProbeWorkflow(): Promise<DavieProbeReport> {
  "use workflow";

  const direct = await probeDavieDirectStep();
  await sleep(PROBE_INTERVAL);
  const cookieBootstrap = await probeDavieCookieBootstrapStep();
  await sleep(PROBE_INTERVAL);
  const hyperbrowser = await probeDavieHyperbrowserStep();
  return { results: [direct, cookieBootstrap, hyperbrowser] };
}
