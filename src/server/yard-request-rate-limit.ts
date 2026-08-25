import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import {
  checkRateLimit,
  getClientIp,
  type RateLimiterLike,
} from "~/lib/rate-limit";

export const YARD_REQUEST_RATE_LIMIT_POLICY = {
  prefix: "ratelimit:yard-request",
  limit: 3,
  window: "1 h",
} as const;

let yardRequestLimiter: Ratelimit | undefined;

async function getYardRequestLimiter(): Promise<Ratelimit> {
  if (yardRequestLimiter) return yardRequestLimiter;

  const { env } = await import("~/env");
  yardRequestLimiter = new Ratelimit({
    redis: new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    }),
    limiter: Ratelimit.slidingWindow(
      YARD_REQUEST_RATE_LIMIT_POLICY.limit,
      YARD_REQUEST_RATE_LIMIT_POLICY.window,
    ),
    prefix: YARD_REQUEST_RATE_LIMIT_POLICY.prefix,
  });
  return yardRequestLimiter;
}

export async function checkYardRequestRateLimit(
  headers: Headers,
  limiterOverride?: RateLimiterLike,
): Promise<boolean> {
  const limiter = limiterOverride ?? (await getYardRequestLimiter());
  return checkRateLimit(limiter, getClientIp(headers));
}
