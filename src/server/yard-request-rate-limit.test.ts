import { describe, expect, test } from "bun:test";
import {
  checkYardRequestRateLimit,
  YARD_REQUEST_RATE_LIMIT_POLICY,
} from "./yard-request-rate-limit";

describe("yard request rate limiting", () => {
  test("keeps the three-per-hour policy in one feature boundary", () => {
    expect(YARD_REQUEST_RATE_LIMIT_POLICY).toEqual({
      prefix: "ratelimit:yard-request",
      limit: 3,
      window: "1 h",
    });
  });

  test("limits by the request IP", async () => {
    let limitedIdentifier: string | undefined;
    const allowed = await checkYardRequestRateLimit(
      new Headers({ "x-real-ip": "1.2.3.4" }),
      {
        limit: (identifier) => {
          limitedIdentifier = identifier;
          return Promise.resolve({ success: true });
        },
      },
    );

    expect(allowed).toBe(true);
    expect(limitedIdentifier).toBe("1.2.3.4");
  });
});
