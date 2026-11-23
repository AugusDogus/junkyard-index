import { describe, expect, test } from "bun:test";

const MODULE = new URL("./require-admin.ts", import.meta.url).pathname;

/**
 * Runs requireAdmin in a child process with the session and admin list
 * mocked, so framework mocks stay out of other test files. Resolves the
 * granted user id, or "notFound" when it 404s.
 */
async function requireAdminFor(
  session: { user: { id: string } } | null,
  adminUserIds: string | undefined,
): Promise<string> {
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
      import { mock } from "bun:test";
      mock.module("server-only", () => ({}));
      mock.module("~/lib/auth", () => ({ auth: { api: { getSession: async () => (${JSON.stringify(session)}) } } }));
      mock.module("~/env", () => ({ env: { ADMIN_USER_IDS: ${JSON.stringify(adminUserIds)} } }));
      mock.module("next/headers", () => ({ headers: async () => new Headers() }));
      mock.module("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); } }));
      const { requireAdmin } = await import(${JSON.stringify(MODULE)});
      try { const admin = await requireAdmin(); process.stdout.write(admin.userId); }
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
  return output;
}

describe("requireAdmin", () => {
  test("lets a listed admin through", async () => {
    expect(await requireAdminFor({ user: { id: "owner" } }, "owner")).toBe(
      "owner",
    );
  });

  test("404s a signed-in user who is not listed", async () => {
    expect(await requireAdminFor({ user: { id: "someone" } }, "owner")).toBe(
      "notFound",
    );
  });

  test("404s a signed-out visitor", async () => {
    expect(await requireAdminFor(null, "owner")).toBe("notFound");
  });

  test("404s everyone while ADMIN_USER_IDS is unset", async () => {
    expect(await requireAdminFor({ user: { id: "owner" } }, undefined)).toBe(
      "notFound",
    );
  });
});
