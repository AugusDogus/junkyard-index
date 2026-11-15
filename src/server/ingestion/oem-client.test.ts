import { expect, test } from "bun:test";
import { Effect } from "effect";
import { readOemPage } from "./oem-client";
import { OEM_MAKES } from "./oem-html";
import type { ProviderRequestGate } from "./provider-http-client";

const gate: ProviderRequestGate = (request) => request;
test("OEM rejects foreign requests before network and never retries an HTTP denial", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = Object.assign(
    async () => {
      calls++;
      return new Response("denied", {
        status: 403,
        headers: { "Content-Type": "text/html" },
      });
    },
    { preconnect: original.preconnect },
  );
  try {
    const foreign = await Effect.runPromiseExit(
      readOemPage("https://foreign.example/parts/makes/", gate),
    );
    expect(foreign._tag).toBe("Failure");
    expect(calls).toBe(0);
    const denied = await Effect.runPromiseExit(readOemPage(OEM_MAKES, gate));
    expect(denied._tag).toBe("Failure");
    expect(calls).toBe(1);
  } finally {
    globalThis.fetch = original;
  }
});
