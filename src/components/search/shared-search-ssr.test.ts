import { expect, test } from "bun:test";
import { z } from "zod";
import { renderSharedSearchFixture } from "../../../tests/browser/fixtures/build-shared-search";

test("server results honor the shared query and state before hydration", async () => {
  const html = await renderSharedSearchFixture();
  const match = html.match(
    /window\[Symbol\.for\("InstantSearchInitialResults"\)\] = ([^<]+)/,
  );
  expect(match).not.toBeNull();
  const initial = z
    .object({
      vehicles: z.object({
        state: z.object({
          query: z.string().optional(),
          disjunctiveFacetsRefinements: z.record(z.array(z.string())),
        }),
        results: z.array(
          z.object({
            query: z.string(),
            nbHits: z.number(),
            hits: z.array(z.object({ objectID: z.string() })),
          }),
        ),
      }),
    })
    .parse(JSON.parse(match?.[1] ?? "null"));
  expect(initial.vehicles.state.query).toBe("toyota venza");
  expect(initial.vehicles.state.disjunctiveFacetsRefinements.state).toEqual([
    "Alabama",
  ]);
  expect(initial.vehicles.results[0]).toMatchObject({
    query: "toyota venza",
    nbHits: 1,
    hits: [{ objectID: "venza-al" }],
  });
}, 30_000);

for (const scenario of [
  { query: "(", extra: "", message: "Search could not run" },
  {
    query: "make:Toyota",
    extra: "&fixtureGuest=1",
    message: "Upgrade to use field conditions",
  },
  {
    query: "Toyota OR Ford",
    extra: "&fixtureBooleanReady=0",
    message: "Boolean OR search is temporarily unavailable",
  },
]) {
  test(`shared expression renders recovery instead of hanging: ${scenario.query}${scenario.extra}`, async () => {
    const html = await renderSharedSearchFixture(
      `q=${encodeURIComponent(scenario.query)}&syntax=expression${scenario.extra}`,
    );
    expect(html).toContain(scenario.message);
    expect(html).toContain('action="/search"');
    expect(html).toContain('name="q"');
    expect(html).not.toContain(
      'window[Symbol.for("InstantSearchInitialResults")]',
    );
  }, 15_000);
}
