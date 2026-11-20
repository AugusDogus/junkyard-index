import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { AlgoliaError, SearchBackendBlocked } from "./algolia-error";

/** The shape algoliasearch's ApiError has: a message and an HTTP status. */
function apiError(status: number, message: string) {
  return Object.assign(new Error(message), { name: "ApiError", status });
}

const blocked = () => apiError(403, "Application is blocked");
const context = { operation: "saveObjects", indexName: "vehicles" };

describe("AlgoliaError.classify", () => {
  test.each([
    [apiError(403, "Application is blocked"), "SearchBackendBlocked"],
    [
      apiError(403, "Record quota exceeded, change plan or delete records."),
      "QuotaExceeded",
    ],
    [apiError(429, "Operations quota exceeded"), "QuotaExceeded"],
    [apiError(429, "Too Many Requests"), "RateLimited"],
    [apiError(404, "Index does not exist"), "NotFound"],
    [apiError(400, "Invalid object attributes"), "InvalidRequest"],
    [apiError(403, "Method not allowed with this API key"), "InvalidRequest"],
    [apiError(503, "Service Unavailable"), "Transient"],
    [
      Object.assign(new Error("Unreachable hosts"), { name: "RetryError" }),
      "Transient",
    ],
  ] as const)("%p is %s", (error, tag) => {
    expect(AlgoliaError.classify(context, error)._tag).toBe(tag);
  });

  test("names the block in the error's name and message", () => {
    const error = AlgoliaError.classify(context, blocked());
    expect(error).toBeInstanceOf(SearchBackendBlocked);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("SearchBackendBlocked");
    expect(error.message).toContain("saveObjects on index vehicles");
    expect(error.message).toContain("HTTP 403");
    expect(error.message).toContain("blocked");
    expect(error.status).toBe(403);
  });

  test("unwraps cause chains", () => {
    const wrapped = new Error("Algolia projection failed", {
      cause: new Error("batch 3 failed", { cause: blocked() }),
    });
    expect(AlgoliaError.classify(context, wrapped)._tag).toBe(
      "SearchBackendBlocked",
    );
  });

  test("reports an aggregate's most specific failure", () => {
    const aggregate = new AggregateError(
      [apiError(503, "Service Unavailable"), blocked()],
      "Algolia rebuild failed and its temporary index could not be removed.",
    );
    expect(AlgoliaError.classify(context, aggregate)._tag).toBe(
      "SearchBackendBlocked",
    );
  });

  test("unwraps Effect fiber failures and defects", async () => {
    const failed = await Effect.runPromise(Effect.fail(blocked())).catch(
      (error: unknown) => error,
    );
    const died = await Effect.runPromise(Effect.die(blocked())).catch(
      (error: unknown) => error,
    );
    expect(AlgoliaError.classify(context, failed)._tag).toBe(
      "SearchBackendBlocked",
    );
    expect(AlgoliaError.classify(context, died)._tag).toBe(
      "SearchBackendBlocked",
    );
  });

  test("keeps an already classified error", async () => {
    const original = AlgoliaError.classify(context, blocked());
    const failed = await Effect.runPromise(Effect.fail(original)).catch(
      (error: unknown) => error,
    );
    expect(AlgoliaError.classify({ operation: "projector" }, failed)).toBe(
      original,
    );
  });

  test("calls an unknown failure transient and keeps its message", () => {
    const error = AlgoliaError.classify(context, new Error("socket hang up"));
    expect(error._tag).toBe("Transient");
    expect(error.status).toBeNull();
    expect(error.message).toContain("socket hang up");
  });
});

test("sync-algolia fails Algolia calls with tagged errors", () => {
  // Module mocks leak across the suite, so this runs in its own process.
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
    import { mock } from "bun:test";
    import { Effect, Either } from "effect";
    mock.module("~/lib/algolia", () => ({
      ALGOLIA_INDEX_NAME: "vehicles",
      getAlgoliaAdminClient: () => ({
        saveObjects: async () => {
          throw Object.assign(new Error("Application is blocked"), {
            name: "ApiError",
            status: 403,
          });
        },
      }),
    }));
    const { saveAlgoliaObjects } = await import(
      "./src/server/ingestion/sync-algolia.ts"
    );
    const result = await Effect.runPromise(
      Effect.either(saveAlgoliaObjects([{ objectID: "VIN-1" }])),
    );
    console.log(JSON.stringify(
      Either.isLeft(result)
        ? { tag: result.left._tag ?? null, name: result.left.name }
        : { tag: "succeeded" },
    ));
  `,
    ],
    { cwd: process.cwd() },
  );
  expect(result.exitCode).toBe(0);
  const lines = result.stdout.toString().trim().split("\n");
  expect(JSON.parse(lines.at(-1) ?? "null")).toEqual({
    tag: "SearchBackendBlocked",
    name: "SearchBackendBlocked",
  });
});
