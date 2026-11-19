import { expect, test } from "bun:test";
import { createVpicClient } from "./vpic-client";
import { VinDecode } from "./vin-decode";

const request = VinDecode.identity("1FTPW14506KD19655", 2006);
if (!request) throw new Error("Invalid test VIN");

test("batches at 50, serializes calls, sends generic form requests and retries rate limits and 5xx", async () => {
  const bodies: string[] = [];
  const delays: number[] = [];
  const statuses = [429, 503, 200, 200];
  const client = createVpicClient({
    sleep: async (ms) => {
      delays.push(ms);
    },
    fetch: async (url, init) => {
      expect(url).toBe(
        "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/",
      );
      expect(init.method).toBe("POST");
      expect(JSON.stringify(init.headers)).not.toMatch(/junkyard|augie|augus/i);
      const body = String(init.body);
      bodies.push(body);
      const status = statuses.shift() ?? 200;
      return new Response(JSON.stringify({ Results: [] }), {
        status,
        headers: { "Retry-After": "2" },
      });
    },
  });
  await client.decode(Array.from({ length: 51 }, () => request));
  expect(bodies).toHaveLength(4);
  expect(new URLSearchParams(bodies[0]).get("data")?.split(";")).toHaveLength(
    50,
  );
  expect(new URLSearchParams(bodies[3]).get("data")?.split(";")).toHaveLength(
    1,
  );
  expect(delays).toEqual([1000, 2000, 2000, 2000, 4000, 1000]);
});

test("outages and malformed bodies yield no identities; long Retry-After defers requests", async () => {
  for (const [index, response] of [
    () => {
      throw new Error("offline");
    },
    () => new Response("{"),
    () => new Response("", { status: 429, headers: { "Retry-After": "120" } }),
  ].entries()) {
    let calls = 0;
    const client = createVpicClient({
      sleep: async () => {},
      fetch: async () => {
        calls++;
        return response();
      },
    });
    expect((await client.decode([request])).decodes.size).toBe(0);
    expect(calls).toBe(index === 2 ? 1 : 3);
  }
});

test("JSON service errors trip the circuit, while valid rejected decodes do not", async () => {
  for (const [body, expectedStatus, attempts] of [
    [{ error: "unavailable" }, "unavailable", 3],
    [{ Results: [] }, "complete", 1],
  ] as const) {
    let calls = 0;
    const decoder = createVpicClient({
      sleep: async () => {},
      fetch: async () => {
        calls++;
        return Response.json(body);
      },
    });
    expect((await decoder.decode([request])).status).toBe(expectedStatus);
    expect(calls).toBe(attempts);
  }
});
