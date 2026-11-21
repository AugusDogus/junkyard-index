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
  test("leaves the yard map to signed-in visitors", async () => {
    // Next's matcher helper sets up AsyncLocalStorage state that breaks later
    // test files in the same Bun process, so it runs in a child.
    const child = Bun.spawn(
      [
        process.execPath,
        "--eval",
        `
        import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
        const { config } = await import(${JSON.stringify(new URL("./proxy.ts", import.meta.url).pathname)});
        const cookies = { "better-auth.session_token": "session" };
        process.stdout.write(JSON.stringify(["/map", "/"].map((url) => unstable_doesMiddlewareMatch({ config, url, cookies }))));
      `,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [output, errors, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(errors).toBe("");
    expect(exitCode).toBe(0);
    expect(output).toBe("[false,true]");
  });
});
