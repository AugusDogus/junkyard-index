import { describe, expect, test } from "bun:test";

const MODULE = new URL("./require-admin.ts", import.meta.url).pathname;

/**
 * Runs `script` against require-admin.ts in a child process with the session
 * and admin list mocked, so framework mocks stay out of other test files.
 * Resolves what the script writes to stdout.
 */
async function runWith(
  session: { user: { id: string } } | null,
  adminUserIds: string | undefined,
  script: string,
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
      const { requireAdmin, adminMetadata } = await import(${JSON.stringify(MODULE)});
      ${script}
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

/** The granted user id, or "notFound" when requireAdmin 404s. */
function requireAdminFor(
  session: { user: { id: string } } | null,
  adminUserIds: string | undefined,
): Promise<string> {
  return runWith(
    session,
    adminUserIds,
    `try { const admin = await requireAdmin(); process.stdout.write(admin.userId); }
     catch (error) { if (error instanceof Error) process.stdout.write(error.message); else throw error; }`,
  );
}

/** adminMetadata's result for a page titled "Sources", as JSON. */
function metadataFor(
  session: { user: { id: string } } | null,
  adminUserIds: string | undefined,
): Promise<string> {
  return runWith(
    session,
    adminUserIds,
    `process.stdout.write(JSON.stringify(await adminMetadata({ title: "Sources" })));`,
  );
}

describe("adminMetadata", () => {
  test("gives an admin the page's metadata", async () => {
    expect(await metadataFor({ user: { id: "owner" } }, "owner")).toBe(
      JSON.stringify({ title: "Sources" }),
    );
  });

  test("gives anyone else nothing, so their 404 names no admin page", async () => {
    expect(await metadataFor(null, "owner")).toBe("{}");
    expect(await metadataFor({ user: { id: "someone" } }, "owner")).toBe("{}");
  });
});

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
