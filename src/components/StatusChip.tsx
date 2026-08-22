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
  ["operational", { dot: "bg-green-500", label: "All systems operational" }],
  ["degraded", { dot: "bg-amber-500", label: "Degraded performance" }],
  ["downtime", { dot: "bg-red-500", label: "Service disruption" }],
]);

const FALLBACK_STATE = { dot: "bg-gray-400", label: "System status" };

async function getAggregateState(
  statusPageUrl: string,
): Promise<{ dot: string; label: string } | null> {
  try {
    const response = await fetch(
      `${statusPageUrl.replace(/\/+$/, "")}/index.json`,
      {
        next: { revalidate: 300 },
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

export async function StatusChip({ statusPageUrl }: { statusPageUrl: string }) {
  const state = await getAggregateState(statusPageUrl);

  return (
    <a
      href={statusPageUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs whitespace-nowrap transition-colors sm:ml-auto"
    >
      {state && (
        <span className={`inline-block h-2 w-2 rounded-full ${state.dot}`} />
      )}
      {state?.label ?? FALLBACK_STATE.label}
    </a>
  );
}
