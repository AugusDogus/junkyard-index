import { unstable_cache } from "next/cache";
import { z } from "zod";

const statusPageResponseSchema = z.object({
  data: z
    .object({
      attributes: z
        .object({
          aggregate_state: z.string(),
        })
        .optional(),
    })
    .optional(),
});

// Map (not a plain object) so remote aggregate_state strings can never hit
// Object.prototype keys like "constructor" or "__proto__".
const STATE_STYLES = new Map<string, { dot: string; label: string }>([
  ["operational", { dot: "bg-success", label: "All systems operational" }],
  ["degraded", { dot: "bg-figure", label: "Degraded performance" }],
  ["downtime", { dot: "bg-error", label: "Service disruption" }],
]);

const FALLBACK_STATE = { dot: "bg-ink-3", label: "System status" };

async function loadAggregateState(
  statusPageUrl: string,
): Promise<{ dot: string; label: string } | null> {
  try {
    const response = await fetch(
      `${statusPageUrl.replace(/\/+$/, "")}/index.json`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      },
    );
    if (!response.ok) return null;

    const parsed = statusPageResponseSchema.safeParse(await response.json());
    if (!parsed.success) return null;

    return (
      STATE_STYLES.get(parsed.data.data?.attributes?.aggregate_state ?? "") ??
      FALLBACK_STATE
    );
  } catch {
    return null;
  }
}

/**
 * The status page's state, cached for five minutes. Cached here rather than
 * in the fetch cache: Next revalidates a stale cached fetch in the background
 * without its abort signal and logs any failure, so an unreachable status
 * page waited out the 10 s connect timeout and logged on page renders. This
 * loader never throws, so revalidating it logs nothing; a failed read shows
 * the plain label until the next one. Bound so every route bundle shares one
 * entry (see cacheInventory).
 */
export const getAggregateState = unstable_cache(
  loadAggregateState.bind(null),
  ["status-chip-state-v1"],
  { revalidate: 300 },
);

export async function StatusChip({ statusPageUrl }: { statusPageUrl: string }) {
  const state = await getAggregateState(statusPageUrl);

  return (
    <a
      href={statusPageUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="board-step text-ink-2 hover:text-signal focus-visible:outline-focus inline-flex min-h-11 items-center gap-2 text-sm whitespace-nowrap focus-visible:outline-2 focus-visible:outline-solid sm:min-h-9"
    >
      {state && (
        <span
          aria-hidden="true"
          className={`inline-block size-2.5 ${state.dot}`}
        />
      )}
      {state?.label ?? FALLBACK_STATE.label}
    </a>
  );
}
