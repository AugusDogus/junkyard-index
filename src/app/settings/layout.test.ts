import { describe, expect, test } from "bun:test";

describe("signed-out settings redirects", () => {
  for (const path of [
    "/settings/billing",
    "/settings/notifications?from=search",
    "/settings/searches",
  ]) {
    test(`returns to ${path} after sign-in`, async () => {
      // Isolate framework mocks from other test files in the same Bun shard.
      const child = Bun.spawn(
        [
          process.execPath,
          "--eval",
          `
        import { mock } from "bun:test";
        mock.module("~/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
        mock.module("next/headers", () => ({ headers: async () => new Headers({ "x-settings-return-to": ${JSON.stringify(path)} }) }));
        mock.module("next/navigation", () => ({ redirect: (href) => { throw new Error(href); } }));
        for (const name of ["AppProviders", "PageShell", "settings/SettingsNav"]) {
          mock.module("~/components/" + name, () => ({ [name.split("/").at(-1)]: () => null }));
        }
        const { default: layout } = await import(${JSON.stringify(new URL("./layout.tsx", import.meta.url).pathname)});
        try { await layout({ children: null }); }
        catch (error) { if (error instanceof Error) process.stdout.write(error.message); else throw error; }
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
      expect(output).toBe(`/auth/sign-in?returnTo=${encodeURIComponent(path)}`);
    });
  }
});
