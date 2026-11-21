/**
 * Stands in for `src/lib/analytics.ts` in browser fixtures. Instead of
 * loading PostHog it records each event on the page, where tests read it
 * from `document.documentElement.dataset.analyticsEvents`.
 */
function capture(event: string, properties?: Record<string, unknown>): void {
  if (typeof document === "undefined") return;
  const previous: unknown = JSON.parse(
    document.documentElement.dataset.analyticsEvents ?? "[]",
  );
  const log: unknown[] = Array.isArray(previous) ? previous : [];
  log.push({ event, properties: properties ?? {} });
  document.documentElement.dataset.analyticsEvents = JSON.stringify(log);
}

export const Analytics = {
  start(): void {},
  capture,
  identify(): void {},
  reset(): void {},
  async distinctId(): Promise<string | undefined> {
    return undefined;
  },
} as const;
