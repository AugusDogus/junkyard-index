// Data-only provider choices. Never import provider implementations here.

/** The remote browser service that opens a source's sessions. Each has its
 * own account, session lease group and concurrency limit. */
export type BrowserProvider = "hyperbrowser" | "kernel";

/** Sources that open one remote browser per chunk and choose its provider as
 * a whole: through a `DocumentTransport` page, or, for Vander Haags and U Pull
 * It Davie, a page their own session module drives over CDP, or, for U Pull R
 * Parts, the Turnstile minter's tabs. */
export type BrowserSource =
  | "bigd"
  | "northwest"
  | "vanderhaags"
  | "upullitdavie"
  | "upullrparts"
  | "six03"
  | "citymotors"
  | "michigantruck";

/**
 * Which provider opens each source's browsers. Moving a source is this one
 * line: the lease, key and capacity refusal follow the provider, and cursors
 * do not depend on it. Kernel is the long-term provider; Michigan Truck is
 * retired (paused and hidden in source_control) and stays where it was. See
 * docs/runbooks/browser-providers.md before moving one.
 */
export const BROWSER_PROVIDERS: Readonly<
  Record<BrowserSource, BrowserProvider>
> = {
  bigd: "kernel",
  northwest: "kernel",
  vanderhaags: "kernel",
  upullitdavie: "kernel",
  // Kernel browsers are metered against U Pull R Parts' daily and monthly
  // Kernel caps (KERNEL_DAILY_BUDGET_USD in kernel-usage.ts); on Hyperbrowser
  // they would mint without them.
  upullrparts: "kernel",
  // 603 and City Motors are metered against their own Kernel caps too.
  six03: "kernel",
  citymotors: "kernel",
  michigantruck: "hyperbrowser",
};
