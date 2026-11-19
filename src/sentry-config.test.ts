import { describe, expect, test } from "bun:test";

// Each config calls Sentry.init on import, so load it in its own process with
// the SDK mocked and the deployment environment set.
function sentryEnabled(config: string, vercelEnv: string | undefined) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    VERCEL_ENV: vercelEnv,
  };
  if (vercelEnv === undefined) delete env.VERCEL_ENV;
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
    import { mock } from "bun:test";
    mock.module("@sentry/nextjs", () => ({
      init: (options) => console.log(JSON.stringify(options.enabled)),
    }));
    await import("./${config}");
  `,
    ],
    { cwd: process.cwd(), env },
  );
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  return result.stdout.toString().trim();
}

describe.each(["sentry.server.config.ts", "sentry.edge.config.ts"])(
  "%s",
  (config) => {
    test("reports from the production deployment", () => {
      expect(sentryEnabled(config, "production")).toBe("true");
    });

    test.each(["preview", "development", undefined])(
      "stays off when VERCEL_ENV is %p",
      (vercelEnv) => {
        expect(sentryEnabled(config, vercelEnv)).toBe("false");
      },
    );
  },
);
