import { Data, Duration, Effect, type Scope } from "effect";
import { z } from "zod";
import { BrowserSessionError } from "./errors";
import {
  PROVIDER_CHUNK_WALL_LIMIT,
  ProviderCapacityDeferred,
  ProviderTurnDeferred,
} from "./provider-chunk-clock";
import {
  providerHostLease,
  type ProviderHostGroup,
  type ProviderLeasePolicy,
} from "./provider-host-slot";

const ConcurrencySchema = z
  .string()
  .regex(/^[1-9][0-9]{0,2}$/)
  .transform(Number);

export const KernelConcurrency = {
  /** The plan's concurrent browser limit from its environment value: unset
   * or empty is 5, the Developer (free) plan's limit. */
  parse(raw: string | undefined): number {
    if (raw === undefined || raw === "") return 5;
    const parsed = ConcurrencySchema.safeParse(raw);
    if (!parsed.success)
      throw new Error(
        `KERNEL_CONCURRENT_SESSIONS must be the Kernel plan's concurrent browser limit as a whole number from 1 to 999 (5 on Developer, 10 on Hobbyist), but it is ${JSON.stringify(raw)}. It is read when the ingestion modules load, so no ingestion source can start until it is fixed; set it to the plan's limit, or unset it to use 5.`,
      );
    return parsed.data;
  },
} as const;

/** Browsers the Kernel plan lets the organization keep open at once: 5 on
 * Developer. Set `KERNEL_CONCURRENT_SESSIONS` with the plan; a higher value
 * than the plan allows only makes chunks defer on the plan's refusal. */
export const KERNEL_CONCURRENT_SESSIONS = KernelConcurrency.parse(
  process.env.KERNEL_CONCURRENT_SESSIONS,
);

/** Every ingestion source that can open Kernel browsers. A source must be
 * listed to take the session lease; `browser-providers.ts` chooses which of
 * them do. U Pull R Parts mints Turnstile tokens in its
 * Kernel browsers. */
export const KERNEL_SOURCES = [
  "bigd",
  "northwest",
  "vanderhaags",
  "upullitdavie",
  "six03",
  "michigantruck",
  "upullrparts",
] as const;
export type KernelSource = (typeof KERNEL_SOURCES)[number];

/** Whether a Kernel browser runs with a display. Headful browsers bill about
 * eight times as much ($0.48 against $0.06 an hour, November 2026). */
export type KernelBrowserMode = "headless" | "headful";

/** How a Kernel browser reaches sites: directly from Kernel's network, as
 * Hyperbrowser ran, or through Kernel's default stealth proxy. */
export type KernelEgress = "direct" | "stealthProxy";

/** How a source's Kernel browsers are created. */
export interface KernelBrowserProfile {
  readonly mode: KernelBrowserMode;
  readonly egress: KernelEgress;
}

/** Every source not in `KERNEL_BROWSER_PROFILES`. The stealth proxy returned
 * 502s and in-page network errors on Northwest (November 23, 2026). */
const DEFAULT_BROWSER_PROFILE: KernelBrowserProfile = {
  mode: "headless",
  egress: "direct",
};

/**
 * Sources whose browsers differ from the headless, direct default.
 *
 * upullrparts: headful, because in a headless stealth browser the Turnstile
 * widget crashes (Cloudflare error 300031) in most tabs and issues no token.
 * Stealth proxy, because one live chunk's 32 tokens took 72 browser-seconds
 * through it and 124 with direct egress, with the same 195 vehicles either
 * way: about $0.26 a crawl against $0.45 (November 23, 2026).
 */
const KERNEL_BROWSER_PROFILES: Partial<
  Record<KernelSource, KernelBrowserProfile>
> = { upullrparts: { mode: "headful", egress: "stealthProxy" } };

/** Kernel deletes a browser this long after its last CDP connection closes,
 * even when the delete call fails or the process that opened it dies. A chunk
 * stays connected from just after create until it deletes the browser. */
export const KERNEL_SESSION_TIMEOUT_SECONDS = 60;

const KERNEL_API = "https://api.onkernel.com";
const KERNEL_REQUEST_TIMEOUT_MS = 30_000;
const ERROR_BODY_PREFIX_CHARS = 500;

/** A Kernel API request that did not succeed. */
export class KernelApiError extends Data.TaggedError("KernelApiError")<{
  operation: "create" | "delete";
  status: number;
  /** Kernel's error `code`, such as `org_limit_exceeded`, when it sent one. */
  code: string | null;
  detail: string;
}> {
  override get message() {
    return `Kernel browser ${this.operation} returned HTTP ${this.status}${this.code ? ` (${this.code})` : ""}: ${this.detail}`;
  }
}

/** Which source asked for a Kernel browser without `KERNEL_API_KEY`. */
export class KernelKeyMissing extends Data.TaggedError("KernelKeyMissing")<{
  source: KernelSource;
}> {
  override get message() {
    return `KERNEL_API_KEY is not set, but ${this.source} is configured to open Kernel browser sessions (browser-providers.ts). No browser was opened and no request was sent, so prior inventory is preserved. Set KERNEL_API_KEY in the deployment's environment and redeploy, or move the source back to Hyperbrowser (docs/runbooks/browser-providers.md).`;
  }
}

const ErrorBodySchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
});

async function apiError(
  operation: KernelApiError["operation"],
  response: Response,
): Promise<KernelApiError> {
  const text = await response.text().catch(() => "");
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: report the text prefix below.
  }
  const parsed = ErrorBodySchema.safeParse(body);
  return new KernelApiError({
    operation,
    status: response.status,
    code: (parsed.success && parsed.data.code) || null,
    detail:
      (parsed.success && parsed.data.message) ||
      text.slice(0, ERROR_BODY_PREFIX_CHARS) ||
      "no body",
  });
}

const CreatedSchema = z.object({
  session_id: z.string().min(1),
  cdp_ws_url: z.string().url(),
});

/** What callers use of a created browser. */
interface SessionHandle {
  readonly id: string;
  readonly wsEndpoint: string;
}

const SESSION_GROUP: ProviderHostGroup = {
  key: "kernel",
  activeLanes: KERNEL_CONCURRENT_SESSIONS,
};

/** How `source`'s browsers are created: its `KERNEL_BROWSER_PROFILES` entry,
 * else headless with direct egress. */
const browserProfile = (source: KernelSource): KernelBrowserProfile =>
  KERNEL_BROWSER_PROFILES[source] ?? DEFAULT_BROWSER_PROFILE;

/** One lane per source, since a source runs one chunk at a time, under one
 * group whose places are the plan's concurrent browsers. */
const policy = (source: KernelSource): ProviderLeasePolicy => ({
  key: "kernel:" + source,
  label: "Kernel browser for " + source,
  // A chunk deletes its browser within the chunk wall limit; a holder that
  // died dropped its CDP connection, so Kernel deletes the browser after the
  // inactivity timeout. The lease outlives both.
  leaseMs:
    Duration.toMillis(PROVIDER_CHUNK_WALL_LIMIT) +
    (KERNEL_SESSION_TIMEOUT_SECONDS + 60) * 1_000,
  waitMs: 5 * 60_000,
  pollMs: 1_000,
  group: SESSION_GROUP,
});

const authorization = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
});

/**
 * Coordinates Kernel browsers across sources and workflow runs, so no more
 * than `KERNEL_CONCURRENT_SESSIONS` are open at once. The lease and lock order
 * are the same as `HyperbrowserSessions`, in a separate lane group, since the
 * two providers' limits are independent.
 */
export const KernelSessions = {
  policy,
  browserProfile,

  /** Holds `source`'s place among the plan's concurrent browsers for the
   * enclosing scope, as `HyperbrowserSessions.lease` does. */
  lease: (
    source: KernelSource,
  ): Effect.Effect<
    void,
    ProviderTurnDeferred | BrowserSessionError,
    Scope.Scope
  > =>
    providerHostLease(policy(source)).pipe(
      Effect.mapError((cause) =>
        cause instanceof ProviderTurnDeferred
          ? cause
          : new BrowserSessionError({ phase: "lease", cause }),
      ),
    ),

  /** Creates a stealth browser (CAPTCHA solver, 1 GiB, Kernel's default
   * region) with `profile`'s mode and egress, which Kernel deletes after the
   * inactivity timeout. Without a `proxy`, `stealth` routes through Kernel's
   * default stealth proxy. */
  create: async (
    apiKey: string,
    profile: KernelBrowserProfile,
    request: typeof fetch = fetch,
  ): Promise<SessionHandle> => {
    const response = await request(KERNEL_API + "/browsers", {
      method: "POST",
      headers: {
        ...authorization(apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        stealth: true,
        headless: profile.mode === "headless",
        timeout_seconds: KERNEL_SESSION_TIMEOUT_SECONDS,
        ...(profile.egress === "direct" ? { proxy: { mode: "direct" } } : {}),
      }),
      signal: AbortSignal.timeout(KERNEL_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw await apiError("create", response);
    const created = CreatedSchema.parse(await response.json());
    return { id: created.session_id, wsEndpoint: created.cdp_ws_url };
  },

  /** Deletes a browser, ending its billing. A browser Kernel no longer has
   * (HTTP 404) is already deleted. */
  stop: async (
    apiKey: string,
    id: string,
    request: typeof fetch = fetch,
  ): Promise<void> => {
    const response = await request(
      `${KERNEL_API}/browsers/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: authorization(apiKey),
        signal: AbortSignal.timeout(KERNEL_REQUEST_TIMEOUT_MS),
      },
    );
    if (response.ok || response.status === 404) {
      await response.body?.cancel();
      return;
    }
    throw await apiError("delete", response);
  },

  /**
   * The deferral for a browser create that Kernel refused because a capacity,
   * plan or credit limit is in use, or null for any other failure. HTTP 429 is
   * the plan's concurrent browser limit (`org_limit_exceeded`, observed
   * November 23, 2026) or the create rate limit; 529 is Kernel's own capacity;
   * 403 is a spending cap, used-up monthly credit or plan limit, which lasts
   * until the next monthly period or a higher cap. Every one keeps the
   * source's checkpoint and retries it later instead of failing the run.
   */
  capacityDeferral: (cause: unknown): ProviderCapacityDeferred | null => {
    if (!(cause instanceof KernelApiError) || cause.operation !== "create")
      return null;
    const reason =
      cause.status === 429
        ? cause.code === "org_limit_exceeded"
          ? `Every place in the plan's concurrent browsers is in use: a soak or manual browser, one whose delete failed (Kernel deletes it ${KERNEL_SESSION_TIMEOUT_SECONDS} seconds after its connection closes), or a plan with fewer browsers than KERNEL_CONCURRENT_SESSIONS (${KERNEL_CONCURRENT_SESSIONS}).`
          : "The organization's browser create rate limit is reached."
        : cause.status === 529
          ? "Kernel has no browser capacity right now."
          : cause.status === 403
            ? "Kernel refuses new browsers once the organization's spending cap or included monthly credit is used up, or the plan does not allow the request, until the next monthly period or a higher cap. Check usage and the cap in the Kernel dashboard, or move the source back to Hyperbrowser (docs/runbooks/browser-providers.md)."
            : null;
    return reason === null
      ? null
      : new ProviderCapacityDeferred({
          provider: "Kernel",
          detail: `${cause.message} ${reason} Check the organization's browsers and limits with GET /org/limits if this repeats.`,
        });
  },
} as const;
