// Data-only provider choices. Never import provider implementations here.

/** The remote browser service that opens a source's sessions. Each has its
 * own account, session lease group and concurrency limit. */
export type BrowserProvider = "hyperbrowser" | "kernel";

/** Sources that read their documents through one `DocumentTransport` browser
 * per chunk and choose its provider as a whole. URG IIS chooses per tenant
 * (`transport` in `urgiis-configuration.ts`). */
export type BrowserSource = "bigd" | "northwest" | "six03" | "michigantruck";

/**
 * Which provider opens each source's browsers. Moving a source is this one
 * line: the lease, key and capacity refusal follow the provider, and cursors
 * do not depend on it. See docs/runbooks/browser-providers.md before moving
 * one.
 */
export const BROWSER_PROVIDERS: Readonly<
  Record<BrowserSource, BrowserProvider>
> = {
  bigd: "hyperbrowser",
  northwest: "hyperbrowser",
  six03: "hyperbrowser",
  michigantruck: "hyperbrowser",
};
