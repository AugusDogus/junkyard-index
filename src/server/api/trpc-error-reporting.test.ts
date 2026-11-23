import { describe, expect, test } from "bun:test";

const MODULE = new URL("./trpc.ts", import.meta.url).pathname;

type Outcome = { status: number; reported: string[] };

/**
 * Sends `GET /api/trpc/<path>` through the fetch adapter to a small router
 * built on the app's tRPC setup, in a child process with Sentry, auth, and
 * the database mocked so those mocks stay out of other test files. Resolves
 * the response status and the messages sent to Sentry.
 */
async function request(path: string): Promise<Outcome> {
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
      import { mock } from "bun:test";
      const reported = [];
      mock.module("@sentry/nextjs", () => ({
        captureException: (error) => reported.push(error.message),
      }));
      mock.module("~/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
      mock.module("~/lib/db", () => ({ db: {} }));
      const { TRPCError } = await import("@trpc/server");
      const { fetchRequestHandler } = await import("@trpc/server/adapters/fetch");
      const { createTRPCContext, createTRPCRouter, publicProcedure } = await import(${JSON.stringify(MODULE)});
      const router = createTRPCRouter({
        vehicle: createTRPCRouter({
          missing: publicProcedure.query(() => {
            throw new TRPCError({ code: "NOT_FOUND", message: "Vehicle not found" });
          }),
          broken: publicProcedure.query(() => {
            throw new Error("database unreachable");
          }),
        }),
      });
      const req = new Request("https://junkyardindex.com/api/trpc/${path}");
      const res = await fetchRequestHandler({
        endpoint: "/api/trpc",
        req,
        router,
        createContext: () => createTRPCContext({ headers: req.headers, req }),
      });
      console.log(JSON.stringify({ status: res.status, reported }));
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
  const last = output.trim().split("\n").at(-1) ?? "";
  const parsed: unknown = JSON.parse(last);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("status" in parsed) ||
    typeof parsed.status !== "number" ||
    !("reported" in parsed) ||
    !Array.isArray(parsed.reported)
  ) {
    throw new Error(`child printed an unexpected result: ${last}`);
  }
  return {
    status: parsed.status,
    reported: parsed.reported.map((message) => String(message)),
  };
}

describe("tRPC error reporting", () => {
  test("a call to a procedure that does not exist is a 404 and is not reported", async () => {
    expect(await request("status.pipeline")).toEqual({
      status: 404,
      reported: [],
    });
  });

  test("a procedure that throws NOT_FOUND itself is still reported", async () => {
    expect(await request("vehicle.missing")).toEqual({
      status: 404,
      reported: ["Vehicle not found"],
    });
  });

  test("a procedure that fails is still reported", async () => {
    expect(await request("vehicle.broken")).toEqual({
      status: 500,
      reported: ["database unreachable"],
    });
  });
});
