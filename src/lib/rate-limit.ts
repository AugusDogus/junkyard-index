import { ipAddress } from "@vercel/functions";
import * as Sentry from "@sentry/nextjs";

/**
 * Returns the client IP as the rate-limit identifier.
 *
 * Assumes deployment on Vercel: `ipAddress()` (from @vercel/functions) reads
 * exactly one header, `x-real-ip`, which Vercel's proxy sets to the true
 * client IP, so clients cannot spoof it on the platform. The manual
 * `x-forwarded-for` fallback below only engages off Vercel (where that header
 * is client-spoofable; we take the rightmost entry, i.e. the hop closest to
 * our trust boundary); local dev shares one bucket, which is fine.
 */
export function getClientIp(headers: Headers): string {
  return (
    ipAddress(headers) ||
    headers
      .get("x-forwarded-for")
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .at(-1) ||
    "unknown"
  );
}

/** Structural type so tests can stub a limiter without the Upstash SDK. */
export interface RateLimiterLike {
  limit(identifier: string): Promise<{ success: boolean }>;
}

/** Returns false when the limit is exceeded, or true when the limiter itself
 * fails (availability over enforcement; failures are logged). */
export async function checkRateLimit(
  limiter: RateLimiterLike,
  identifier: string,
): Promise<boolean> {
  try {
    const { success } = await limiter.limit(identifier);
    return success;
  } catch (error) {
    console.error("Rate limiter check failed; allowing request", error);
    Sentry.captureException(error, {
      tags: { context: "rate-limit-fail-open" },
    });
    return true;
  }
}
