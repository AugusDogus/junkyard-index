import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { proxy, config } from "./proxy";

describe("settings auth destination", () => {
  for (const path of [
    "/settings/billing",
    "/settings/notifications?from=search",
    "/settings/account",
    "/settings/searches",
  ]) {
    test(`forwards the requested destination ${path}`, () => {
      const response = proxy(
        new NextRequest(`https://app.example${path}`, {
          headers: { "x-settings-return-to": "https://evil" },
        }),
      );
      expect(
        response.headers.get("x-middleware-request-x-settings-return-to"),
      ).toBe(path);
      expect(config.matcher).toContain("/settings/:path*");
    });
  }
  test("still sends signed-in homepage visits to search", () => {
    const response = proxy(
      new NextRequest("https://app.example/", {
        headers: { cookie: "better-auth.session_token=session" },
      }),
    );
    expect(response.headers.get("location")).toBe("https://app.example/search");
  });
});
