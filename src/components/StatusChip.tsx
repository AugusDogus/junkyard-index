import { unstable_cache } from "next/cache";
import { SiteStatus } from "~/lib/site-status";

// Only a site problem earns a mark. Operational reads the same as an
// unknown state, so pages cached at different times, or rendered while the
// status page was unreachable, show the same footer.
const PROBLEMS = {
  degraded: { dot: "bg-figure", label: "Degraded performance" },
  downtime: { dot: "bg-error", label: "Service disruption" },
} as const;

async function loadSiteStatus(statusPageUrl: string): Promise<SiteStatus> {
  try {
    const response = await fetch(
      `${statusPageUrl.replace(/\/+$/, "")}/index.json`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      },
    );
    if (!response.ok) return "unknown";
    return SiteStatus.parse(await response.json());
  } catch {
    return "unknown";
  }
}

/**
 * The site's status, cached for five minutes. Cached here rather than in the
 * fetch cache: Next revalidates a stale cached fetch in the background
 * without its abort signal and logs any failure, so an unreachable status
 * page waited out the 10 s connect timeout and logged on page renders. This
 * loader never throws, so revalidating it logs nothing; a failed read shows
 * the plain label until the next one. Bound so every route bundle shares one
 * entry (see cacheInventory).
 */
export const getSiteStatus = unstable_cache(
  loadSiteStatus.bind(null),
  ["status-chip-state-v2"],
  { revalidate: 300 },
);

/** The footer link for a known site status. */
export function StatusChipLink({
  statusPageUrl,
  status,
}: {
  statusPageUrl: string;
  status: SiteStatus;
}) {
  const problem =
    status === "degraded" || status === "downtime" ? PROBLEMS[status] : null;

  return (
    <a
      href={statusPageUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="board-step text-ink-2 hover:text-signal focus-visible:outline-focus inline-flex min-h-11 items-center gap-2 text-sm whitespace-nowrap focus-visible:outline-2 focus-visible:outline-solid sm:min-h-9"
    >
      {problem && (
        <span
          aria-hidden="true"
          className={`inline-block size-2.5 ${problem.dot}`}
        />
      )}
      {problem?.label ?? "System status"}
    </a>
  );
}

export async function StatusChip({ statusPageUrl }: { statusPageUrl: string }) {
  return (
    <StatusChipLink
      statusPageUrl={statusPageUrl}
      status={await getSiteStatus(statusPageUrl)}
    />
  );
}
