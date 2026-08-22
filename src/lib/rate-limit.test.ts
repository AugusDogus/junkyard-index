// Keep env validation from running when the module graph loads without secrets.
process.env.SKIP_ENV_VALIDATION = "1";

import { describe, expect, test } from "bun:test";

const { checkRateLimit, getClientIp } = await import("./rate-limit");

describe("getClientIp", () => {
  test("prefers the proxy-set real IP", () => {
    const headers = new Headers({ "x-real-ip": "1.2.3.4" });
    expect(getClientIp(headers)).toBe("1.2.3.4");
  });

  test("falls back to the rightmost x-forwarded-for entry, trimmed", () => {
    const headers = new Headers({
      "x-forwarded-for": "5.6.7.8 , 9.9.9.9",
    });
    expect(getClientIp(headers)).toBe("9.9.9.9");
  });

  test("returns unknown when no IP headers exist", () => {
    expect(getClientIp(new Headers())).toBe("unknown");
  });
});

describe("getClientIp edge cases", () => {
  test("ignores empty entries in x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "9.9.9.9," });
    expect(getClientIp(headers)).toBe("9.9.9.9");
  });
});

describe("checkRateLimit", () => {
  test("returns true when the limiter allows the request", async () => {
    const allowed = await checkRateLimit(
      { limit: () => Promise.resolve({ success: true }) },
      "1.2.3.4",
    );
    expect(allowed).toBe(true);
  });

  test("returns false when the limit is exceeded", async () => {
    const allowed = await checkRateLimit(
      { limit: () => Promise.resolve({ success: false }) },
      "1.2.3.4",
    );
    expect(allowed).toBe(false);
  });

  test("fails open when the limiter errors", async () => {
    const allowed = await checkRateLimit(
      {
        limit: () => Promise.reject(new Error("upstash down")),
      },
      "1.2.3.4",
    );
    expect(allowed).toBe(true);
  });
});
