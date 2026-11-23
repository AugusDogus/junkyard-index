import { expect, test } from "bun:test";
import { combineSearchFilters } from "./compile-search-expression";
import { HiddenSources } from "./hidden-source";
import { MakeFilter } from "./make-filter";

test("preserves raw and normalized source makes without broadening other records", () => {
  expect(MakeFilter.aliases("GMC", "CHEVROLET")).toEqual([
    "GMC",
    "CHEVROLET",
    "Chevrolet",
  ]);
  expect(MakeFilter.aliases("GMC", "GMC")).toEqual(["GMC"]);
  expect(MakeFilter.aliases("GMC")).not.toContain("Chevrolet");
});

test("basic saved refinements use per-record make aliases while other facets stay unchanged", () => {
  expect(
    MakeFilter.facets([
      ["make:Chevrolet", "make:Ford"],
      "source:pyp",
      ["make:-GMC"],
    ]),
  ).toEqual([
    ["makeAliases:Chevrolet", "makeAliases:Ford"],
    "source:pyp",
    ["makeAliases:-GMC"],
  ]);
});

test("the search client transforms legacy and modern saved refinements through schema readiness", () => {
  const script = `
    import {mock} from 'bun:test';
    const captured = [];
    mock.module('./src/env.js', () => ({env:{NEXT_PUBLIC_ALGOLIA_APP_ID:'fixture',NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY:'fixture'}}));
    mock.module('algoliasearch/lite', () => ({liteClient: () => ({search: async input => {captured.push(input);return {results:(Array.isArray(input)?input:input.requests).map(()=>({hits:[],nbHits:0,page:0,nbPages:0,hitsPerPage:24,processingTimeMS:0}))};}})}));
    const {getSearchClient} = await import('./src/lib/algolia-search');
    const {HiddenSources} = await import('./src/lib/hidden-source');
    const hidden = HiddenSources.of(['meeks']);
    for (const ready of [false,true]) {
      const client = getSearchClient(hidden,true,false,true,ready);
      await client.search([{indexName:'vehicles',params:{query:'Sonoma',facetFilters:[['make:Chevrolet']]}}]);
      await client.search({requests:[{indexName:'vehicles',facetFilters:[['make:Chevrolet']]}]});
      await getSearchClient(hidden,true,true,true,ready).search([{indexName:'vehicles',params:{query:'make:Chevrolet Sonoma'}}]);
    }
    console.log(JSON.stringify(captured));
  `;
  const result = Bun.spawnSync([process.execPath, "--eval", script], {
    cwd: process.cwd(),
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  const calls: unknown = JSON.parse(result.stdout.toString());
  const expected = [false, true].flatMap((ready) => {
    const attribute = ready ? "makeAliases" : "make";
    const facetFilters = ready
      ? [["makeAliases:Chevrolet"]]
      : [["make:Chevrolet", "searchTokens:make=chevrolet"]];
    return [
      [
        {
          indexName: "vehicles",
          params: expect.objectContaining({
            facetFilters,
          }),
        },
      ],
      {
        requests: [{ indexName: "vehicles", facetFilters }],
      },
      [
        {
          indexName: "vehicles",
          params: expect.objectContaining({
            query: "Sonoma",
            // Every request also leaves out the page's hidden sources.
            filters: combineSearchFilters(
              ready
                ? `${attribute}:"Chevrolet"`
                : '(make:"Chevrolet" OR searchTokens:"make=chevrolet")',
              HiddenSources.algoliaFilter(HiddenSources.of(["meeks"])),
            ),
          }),
        },
      ],
    ];
  });
  expect(calls).toMatchObject(expected);
});

test("rollout make facets retain OR selections and excluded makes without widening scope", () => {
  expect(
    MakeFilter.facets(
      [["make:Chevrolet", "make:Ford"], "source:pyp", "make:-GMC"],
      false,
    ),
  ).toEqual([
    [
      "make:Chevrolet",
      "searchTokens:make=chevrolet",
      "make:Ford",
      "searchTokens:make=ford",
    ],
    "source:pyp",
    "make:-GMC",
    "searchTokens:-make=gmc",
  ]);
  expect(MakeFilter.facets([["make:-GMC", "source:pyp"]], false)).toEqual([
    ["make:-GMC", "source:pyp"],
    ["searchTokens:-make=gmc", "source:pyp"],
  ]);
  expect(MakeFilter.token(" Land   Rover ")).toBe("make=land rover");
});
