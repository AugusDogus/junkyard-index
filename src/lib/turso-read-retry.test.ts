import { createClient, LibsqlError } from "@libsql/client/web";
import { describe, expect, test } from "bun:test";
import { DrizzleQueryError, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql/web";
import { isTransientTursoError, retryTursoRead } from "./turso-read-retry";

/** The error the HTTP client raises when Turso answers with `status`. */
function httpError(status: number): LibsqlError {
  const cause = Object.assign(
    new Error(`Server returned HTTP status ${status}`),
    { status },
  );
  return new LibsqlError(
    cause.message,
    "SERVER_ERROR",
    undefined,
    undefined,
    cause,
  );
}

/** A read that fails with each error in turn, then returns "rows". */
function flakyRead(errors: unknown[]) {
  let calls = 0;
  return {
    read: async () => {
      const error = errors[calls];
      calls += 1;
      if (error !== undefined) throw error;
      return "rows";
    },
    calls: () => calls,
  };
}

function recordingSleep() {
  const delays: number[] = [];
  return {
    sleep: async (ms: number) => {
      delays.push(ms);
    },
    delays,
  };
}

const quiet = () => {};

describe("isTransientTursoError", () => {
  test("gateway statuses from Turso are transient", () => {
    expect(isTransientTursoError(httpError(502))).toBe(true);
    expect(isTransientTursoError(httpError(503))).toBe(true);
    expect(isTransientTursoError(httpError(504))).toBe(true);
  });

  test("a gateway status wrapped by Drizzle is transient", () => {
    expect(
      isTransientTursoError(
        new DrizzleQueryError("select 1", [], httpError(502)),
      ),
    ).toBe(true);
  });

  test("other statuses, SQL errors, and non-Turso errors are not", () => {
    expect(isTransientTursoError(httpError(400))).toBe(false);
    expect(isTransientTursoError(httpError(500))).toBe(false);
    expect(
      isTransientTursoError(
        new LibsqlError("no such table: vehicle", "SQLITE_ERROR"),
      ),
    ).toBe(false);
    expect(
      isTransientTursoError(new Error("Server returned HTTP status 502")),
    ).toBe(false);
  });
});

describe("retryTursoRead", () => {
  test("a read that hits one 502 succeeds on the next attempt after a backoff", async () => {
    const flaky = flakyRead([httpError(502)]);
    const { sleep, delays } = recordingSleep();
    expect(await retryTursoRead(flaky.read, { sleep, warn: quiet })).toBe(
      "rows",
    );
    expect(flaky.calls()).toBe(2);
    expect(delays).toEqual([200]);
  });

  test("retries are bounded and the backoff doubles", async () => {
    const outage = httpError(502);
    const flaky = flakyRead([outage, outage, outage, outage]);
    const { sleep, delays } = recordingSleep();
    await expect(
      retryTursoRead(flaky.read, { sleep, warn: quiet }),
    ).rejects.toBe(outage);
    expect(flaky.calls()).toBe(3);
    expect(delays).toEqual([200, 400]);
  });

  test("a Drizzle query against a Turso edge answering 502 is retried", async () => {
    let requests = 0;
    const db = drizzle(
      createClient({
        url: "https://turso.example",
        authToken: "test",
        fetch: async () => {
          requests += 1;
          return new Response("Bad Gateway", {
            status: 502,
            headers: { "content-type": "text/plain" },
          });
        },
      }),
    );
    const { sleep, delays } = recordingSleep();
    const error = await retryTursoRead(() => db.all(sql`select 1`), {
      sleep,
      warn: quiet,
    }).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(DrizzleQueryError);
    expect(requests).toBe(3);
    expect(delays).toEqual([200, 400]);
  });

  test("a non-transient error is thrown at once", async () => {
    const sqlError = new LibsqlError("no such table: vehicle", "SQLITE_ERROR");
    const flaky = flakyRead([sqlError]);
    const { sleep, delays } = recordingSleep();
    await expect(
      retryTursoRead(flaky.read, { sleep, warn: quiet }),
    ).rejects.toBe(sqlError);
    expect(flaky.calls()).toBe(1);
    expect(delays).toEqual([]);
  });

  test("the retry warning names the libsql error under nested wrappers", async () => {
    const nested = new Error("render failed", {
      cause: new DrizzleQueryError("select 1", [], httpError(504)),
    });
    const flaky = flakyRead([nested]);
    const { sleep } = recordingSleep();
    const warnings: string[] = [];
    await retryTursoRead(flaky.read, {
      sleep,
      warn: (message) => warnings.push(message),
    });
    expect(warnings).toEqual([
      "Turso read failed with a transient server error (SERVER_ERROR: Server returned HTTP status 504); retrying in 200 ms (attempt 2 of 3).",
    ]);
  });

  test("each retry is logged as a warning naming the status and attempt", async () => {
    const flaky = flakyRead([httpError(503)]);
    const { sleep } = recordingSleep();
    const warnings: string[] = [];
    await retryTursoRead(flaky.read, {
      sleep,
      warn: (message) => warnings.push(message),
    });
    expect(warnings).toEqual([
      "Turso read failed with a transient server error (SERVER_ERROR: Server returned HTTP status 503); retrying in 200 ms (attempt 2 of 3).",
    ]);
  });
});
