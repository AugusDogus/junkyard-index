// Data-only provider choices. Never import provider implementations here.

/** The remote browser service that opens a source's sessions. Each has its
 * own account, session lease group and concurrency limit. */
export type BrowserProvider = "hyperbrowser" | "kernel";

/** Sources that open one remote browser per chunk and choose its provider as
 * a whole: through a `DocumentTransport` page, or, for Vander Haags and U Pull
 * It Davie, a page their own session module drives over CDP. */
export type BrowserSource =
  | "bigd"
  | "northwest"
  | "vanderhaags"
  | "upullitdavie"
  | "six03"
  | "michigantruck";

/**
 * Which provider opens each source's browsers. Moving a source is this one
 * line: the lease, key and capacity refusal follow the provider, and cursors
 * do not depend on it. Kernel is the long-term provider; 603 and Michigan
 * Truck are retired (paused and hidden in source_control) and stay where they
 * were. See docs/runbooks/browser-providers.md before moving one.
 */
export const BROWSER_PROVIDERS: Readonly<
  Record<BrowserSource, BrowserProvider>
> = {
  bigd: "kernel",
  northwest: "kernel",
  vanderhaags: "kernel",
  upullitdavie: "kernel",
  six03: "hyperbrowser",
  michigantruck: "hyperbrowser",
};
