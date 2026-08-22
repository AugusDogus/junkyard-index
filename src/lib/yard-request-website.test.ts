import { describe, expect, test } from "bun:test";
import { yardRequestWebsiteSchema } from "./yard-request-website";

describe("yardRequestWebsiteSchema", () => {
  const parse = (input: string) =>
    yardRequestWebsiteSchema.safeParse(input).success
      ? yardRequestWebsiteSchema.parse(input)
      : null;

  test("accepts and normalizes schemeless domains", () => {
    expect(parse("example.com")).toBe("https://example.com/");
  });

  test("preserves explicit http(s) urls with paths", () => {
    expect(parse("https://example.com/some/path?q=1")).toBe(
      "https://example.com/some/path?q=1",
    );
    expect(parse("http://example.com")).toBe("http://example.com/");
  });

  test("strips userinfo credentials", () => {
    expect(parse("user:pass@example.com")).toBe("https://example.com/");
    expect(parse("https://user:pass@example.com")).toBe("https://example.com/");
  });

  test("normalizes backslash trickery to a safe host", () => {
    const stored = parse("https://evil.com\\@good.com");
    expect(stored).not.toBeNull();
    expect(stored?.startsWith("https://evil.com/")).toBe(true);
  });

  test("rejects non-http(s) schemes", () => {
    expect(parse("javascript:alert(1)")).toBeNull();
    expect(parse("ftp://example.com")).toBeNull();
  });

  test("rejects single-label hosts and garbage", () => {
    expect(parse("localhost")).toBeNull();
    expect(parse("not a url")).toBeNull();
    expect(parse("")).toBeNull();
  });
});
