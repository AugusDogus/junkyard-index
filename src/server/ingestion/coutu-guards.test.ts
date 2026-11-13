import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { parseCoutuModel } from "./coutu-parser";
import { coutuSnapshot } from "./coutu-snapshot";
import { streamCoutuInventoryWithRequestGate } from "./coutu-connector";
import { COUTU_HOME, COUTU_ROOT, COUTU_ORIGIN } from "./coutu-protocol";
import {
  coutuFixtureHome,
  coutuFixtureMake,
  coutuFixtureModel,
  coutuFixtureRecord,
  coutuFixtureDirectory,
  coutuFixtureModelPage,
} from "./coutu-test-fixtures";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});
const parse = (body: string) =>
  parseCoutuModel(body, coutuFixtureMake, coutuFixtureModel, ["FORD"]);
const baseline = () => coutuFixtureModelPage([coutuFixtureRecord(1)]);

test("required donor remains usable when the optional stock span is omitted", () => {
  const body = baseline().replace("<span>Stock #ST1</span>", "");
  const result = coutuSnapshot([parse(body)]);
  expect(result.vehicles).toHaveLength(1);
  expect(result.vehicles[0]?.stockNumber).toBeNull();
});

test("required donor remains usable when optional mileage markup is omitted", () => {
  const body = baseline().replace("<span>Mileage</span><span>0</span>", "");
  const result = coutuSnapshot([parse(body)]);
  expect(result.vehicles).toHaveLength(1);
});

test("malformed optional stock becomes null rather than rejecting the complete model page", () => {
  const record = coutuFixtureRecord(1);
  record[7] = "S".repeat(101);
  const result = coutuSnapshot([parse(coutuFixtureModelPage([record]))]);
  expect(result.vehicles).toHaveLength(1);
  expect(result.vehicles[0]?.stockNumber).toBeNull();
});

test("unlabelled optional stock does not alter the independent year chip", () => {
  const body = baseline().replace(
    "<span>Stock #ST1</span>",
    "<span>unusable optional stock</span>",
  );
  const result = coutuSnapshot([parse(body)]);
  expect(result.vehicles).toHaveLength(1);
  expect(result.vehicles[0]?.stockNumber).toBeNull();
  expect(result.vehicles[0]?.year).toBe(2000);
});

const continuation =
  '<a rel="next nofollow" aria-label="Next page" href="/browse/ford/f250/2">›</a>';
test("a standard next-link rel token and accessible label stop the model parser", () => {
  expect(() =>
    parse(baseline().replace("</main>", continuation + "</main>")),
  ).toThrow(/pagination|continuation/);
});

test("unvisited explicit next page prevents terminal callbacks even above the floor", async () => {
  const records = Array.from({ length: 1000 }, (_, i) =>
    coutuFixtureRecord(i + 1),
  );
  const modelBody = coutuFixtureModelPage(records).replace(
    "</main>",
    continuation + "</main>",
  );
  const bodies = new Map([
    [COUTU_HOME, coutuFixtureHome],
    [COUTU_ROOT, coutuFixtureDirectory([coutuFixtureMake])],
    [
      COUTU_ORIGIN + coutuFixtureMake.path,
      coutuFixtureDirectory([coutuFixtureModel], coutuFixtureMake),
    ],
    [COUTU_ORIGIN + coutuFixtureModel.path, modelBody],
  ]);
  const requested: string[] = [];
  let emitted = 0;
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      requested.push(url);
      const body = bodies.get(url);
      if (body === undefined) throw new Error("Unexpected offline URL " + url);
      return new Response(body, { headers: { "content-type": "text/html" } });
    },
    { preconnect: original.preconnect },
  );
  const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
  const run = Effect.runPromise(
    streamCoutuInventoryWithRequestGate(
      {
        maxPages: 8,
        onBatch: (rows) =>
          Effect.sync(() => {
            emitted += rows.length;
          }),
      },
      gate,
    ),
  );
  await expect(run).rejects.toThrow(/pagination|continuation/);
  expect(emitted).toBe(0);
  expect(requested).not.toContain(COUTU_ORIGIN + "/browse/ford/f250/2");
});
