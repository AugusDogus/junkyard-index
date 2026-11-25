import { unstable_cache } from "next/cache";
import { env } from "~/env";
import { TursoUsage, type TursoUsageCheck } from "./turso-usage";

/** How long /api/status reuses a usage read. Turso's figures lag anyway. */
const STATUS_CACHE_SECONDS = 60 * 60;

/** Reads this month's Turso usage now. No database rows are read. */
export function checkTursoUsage(
  now: Date = new Date(),
): Promise<TursoUsageCheck> {
  return TursoUsage.check(
    {
      token: env.TURSO_PLATFORM_API_TOKEN,
      organization: env.TURSO_ORGANIZATION,
    },
    now,
  );
}

/**
 * The usage check, read at most once an hour. Each key names its hour, so a
 * stale entry is never served while it refreshes.
 */
export function cachedTursoUsage(): Promise<TursoUsageCheck> {
  const window = Math.floor(Date.now() / (STATUS_CACHE_SECONDS * 1000));
  return unstable_cache(
    () => checkTursoUsage(),
    ["turso-usage-v1", String(window)],
    { revalidate: STATUS_CACHE_SECONDS },
  )();
}
