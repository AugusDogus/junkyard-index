import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { fetchProviderJson } from "./provider-http-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function respondWith(body: string): void {
  globalThis.fetch = Object.assign(
    async () => new Response(body, { status: 200 }),
    { preconnect: originalFetch.preconnect },
  );
}

describe("provider HTTP JSON decoding", () => {
  test("parses and validates a provider response at the transport boundary", async () => {
    respondWith('{"page":3}');

    const result = await Effect.runPromise(
      fetchProviderJson({
        url: "https://provider.example/inventory",
        context: "Example inventory",
        schema: Schema.Struct({ page: Schema.Int }),
      }),
    );

    expect(result).toEqual({ page: 3 });
  });

  test("identifies invalid JSON with provider context", async () => {
    respondWith("not-json");

    await expect(
      Effect.runPromise(
        fetchProviderJson({
          url: "https://provider.example/inventory",
          context: "Example inventory",
          schema: Schema.Struct({ page: Schema.Int }),
        }),
      ),
    ).rejects.toThrow("Example inventory returned invalid JSON");
  });

  test("identifies schema-invalid data with provider context", async () => {
    respondWith('{"page":"three"}');

    await expect(
      Effect.runPromise(
        fetchProviderJson({
          url: "https://provider.example/inventory",
          context: "Example inventory",
          schema: Schema.Struct({ page: Schema.Int }),
        }),
      ),
    ).rejects.toThrow("Example inventory returned invalid data");
  });
});
