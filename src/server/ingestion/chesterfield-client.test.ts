import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { ChesterfieldSession } from "./chesterfield-client";
import {
  chesterfieldPage,
  chesterfieldRecord,
} from "./chesterfield-test-fixtures";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect;
const htmlResponse = (body: string, headers?: Record<string, string>) =>
  new Response(body, { headers: { "content-type": "text/html", ...headers } });
function respond(
  handler: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
) {
  globalThis.fetch = Object.assign(handler, {
    preconnect: originalFetch.preconnect,
  });
}

test("maintains native cookies and rotating form tokens across exact searches", async () => {
  let requests = 0;
  respond(async (_url, init) => {
    requests++;
    expect(init?.redirect).toBe("error");
    if (requests === 1)
      return htmlResponse(chesterfieldPage([], { token: "first-state" }), {
        "set-cookie": "public-session=one; Path=/; HttpOnly",
      });
    const headers = new Headers(init?.headers);
    const body = new URLSearchParams(String(init?.body));
    expect(headers.get("cookie")).toBe("public-session=one");
    expect(body.get("SelectedMake")).toBe("298");
    expect(body.get("BasicSearch.ModelId")).toBe("5017");
    expect(body.get("BasicSearch.BeginYear")).toBe("1962");
    expect(body.get("BasicSearch.EndYear")).toBe("2026");
    expect(body.get("__RequestVerificationToken")).toBe(
      requests === 2 ? "first-state" : "second-state",
    );
    return htmlResponse(
      chesterfieldPage([chesterfieldRecord], { token: "second-state" }),
    );
  });
  const session = await Effect.runPromise(ChesterfieldSession.open(gate));
  expect(
    await Effect.runPromise(session.search({ makeId: "298", modelId: "5017" })),
  ).toEqual([chesterfieldRecord]);
  expect(
    await Effect.runPromise(session.search({ makeId: "298", modelId: "5017" })),
  ).toEqual([chesterfieldRecord]);
  expect(requests).toBe(3);
});

test("loads each make through the native directory and rejects unknown IDs before fetching", async () => {
  let requests = 0;
  respond(async (url) => {
    requests++;
    return htmlResponse(
      chesterfieldPage([], {
        makeId: String(url).endsWith("287") ? "287" : "298",
      }),
    );
  });
  const session = await Effect.runPromise(ChesterfieldSession.open(gate));
  expect(await Effect.runPromise(session.directory("287"))).toEqual([
    { id: "9001", label: "F-150" },
  ]);
  await expect(Effect.runPromise(session.directory("999"))).rejects.toThrow(
    "absent",
  );
  await expect(
    Effect.runPromise(session.search({ makeId: "298", modelId: "0" })),
  ).rejects.toThrow("invalid");
  expect(requests).toBe(2);
});

test.each([
  chesterfieldPage().replace('value="1962"', 'value="2000"'),
  chesterfieldPage()
    .replaceAll('max="2026"', 'max="2027"')
    .replaceAll('value="2026"', 'value="2027"'),
  chesterfieldPage().replace('<option value="287">FORD</option>', ""),
  chesterfieldPage().replace('selected value="5017"', 'selected value="5018"'),
])(
  "rejects changed bounds, directories and unfulfilled filters",
  async (changed) => {
    let requests = 0;
    respond(async () =>
      htmlResponse(++requests === 1 ? chesterfieldPage([]) : changed),
    );
    const session = await Effect.runPromise(ChesterfieldSession.open(gate));
    await expect(
      Effect.runPromise(session.search({ makeId: "298", modelId: "5017" })),
    ).rejects.toThrow("preserved");
  },
);

test.each([403, 206, 302])(
  "rejects HTTP %i before trusting native form state",
  async (status) => {
    respond(
      async () =>
        new Response(chesterfieldPage(), {
          status,
          headers: { "content-type": "text/html" },
        }),
    );
    await expect(
      Effect.runPromise(ChesterfieldSession.open(gate)),
    ).rejects.toThrow("preserved");
  },
);
