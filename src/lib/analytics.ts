import type { PostHog, Properties } from "posthog-js";

/**
 * Product analytics, loaded off the critical path. `posthog-js` is about
 * 176 KB and took 400 ms of main-thread time on a mobile page load, so no
 * page imports it directly: this module loads it after the page has settled
 * (see `start`), or on the first event if that comes sooner, and queues
 * calls until then.
 * Outside a browser (server rendering, tests) every call does nothing.
 */
type Call = (posthog: PostHog) => void;

let client: PostHog | null = null;
let loading: Promise<PostHog> | null = null;
const queued: Call[] = [];

function load(): Promise<PostHog> {
  loading ??= import("posthog-js").then(({ default: posthog }) => {
    // Read directly rather than through `~/env`, whose zod validation would
    // ship with this chunk; next.config.js validates these at build time.
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    // Events, pageviews, identities, and autocapture only. Session replay,
    // surveys, dead clicks, web vitals, feature flags, and remote config all
    // load extra scripts or requests once the page is up, costing every
    // visit main-thread time, and we use none of them. Vercel Analytics
    // still reports visits.
    if (key) {
      posthog.init(key, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
        defaults: "2026-01-30",
        disable_session_recording: true,
        disable_surveys: true,
        capture_dead_clicks: false,
        capture_performance: false,
        advanced_disable_flags: true,
        disable_external_dependency_loading: true,
      });
    }
    client = posthog;
    for (const call of queued.splice(0)) call(posthog);
    return posthog;
  });
  return loading;
}

function withClient(call: Call): void {
  if (typeof window === "undefined") return;
  if (client) {
    call(client);
    return;
  }
  queued.push(call);
  void load();
}

export const Analytics = {
  /**
   * Loads analytics on the visitor's first interaction, or 5 seconds after
   * the page has loaded, whichever comes first. Loading it as soon as the
   * page was idle still cost each visit about 130 ms of main-thread time
   * while the page was settling. Visits shorter than that with no
   * interaction record no pageview here; Vercel Analytics still counts them.
   */
  start(): void {
    const triggers = [
      "pointerdown",
      "keydown",
      "touchstart",
      "scroll",
    ] as const;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const begin = () => {
      for (const trigger of triggers) {
        window.removeEventListener(trigger, begin);
      }
      clearTimeout(timer);
      void load();
    };
    for (const trigger of triggers) {
      window.addEventListener(trigger, begin, { once: true, passive: true });
    }
    const afterLoad = () => {
      timer = setTimeout(begin, 5000);
    };
    if (document.readyState === "complete") afterLoad();
    else window.addEventListener("load", afterLoad, { once: true });
  },

  capture(event: string, properties?: Properties): void {
    withClient((posthog) => posthog.capture(event, properties));
  },

  identify(distinctId: string | undefined, properties?: Properties): void {
    withClient((posthog) => posthog.identify(distinctId, properties));
  },

  reset(): void {
    withClient((posthog) => posthog.reset());
  },

  /** This browser's analytics id, loading analytics first if needed. */
  async distinctId(): Promise<string | undefined> {
    if (typeof window === "undefined") return undefined;
    return (await load()).get_distinct_id();
  },
} as const;
