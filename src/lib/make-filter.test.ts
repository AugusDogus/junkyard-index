import { expect, test } from "bun:test";
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

test("the search client transforms legacy and modern saved refinements only after schema readiness", () => {
  const script = `
    import {mock} from 'bun:test';
    const captured = [];
    mock.module('./src/env.js', () => ({env:{NEXT_PUBLIC_ALGOLIA_APP_ID:'fixture',NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY:'fixture'}}));
    mock.module('algoliasearch/lite', () => ({liteClient: () => ({search: async input => {captured.push(input);return {results:(Array.isArray(input)?input:input.requests).map(()=>({hits:[],nbHits:0,page:0,nbPages:0,hitsPerPage:24,processingTimeMS:0}))};}})}));
    const {getSearchClient} = await import('./src/lib/algolia-search');
    for (const ready of [false,true]) {
      const client = getSearchClient(true,false,true,ready);
      await client.search([{indexName:'vehicles',params:{query:'Sonoma',facetFilters:[['make:Chevrolet']]}}]);
      await client.search({requests:[{indexName:'vehicles',facetFilters:[['make:Chevrolet']]}]});
      await getSearchClient(true,true,true,ready).search([{indexName:'vehicles',params:{query:'make:Chevrolet Sonoma'}}]);
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
    return [
      [
        {
          indexName: "vehicles",
          params: expect.objectContaining({
            facetFilters: [[`${attribute}:Chevrolet`]],
          }),
        },
      ],
      {
        requests: [
          { indexName: "vehicles", facetFilters: [[`${attribute}:Chevrolet`]] },
        ],
      },
      [
        {
          indexName: "vehicles",
          params: expect.objectContaining({
            query: "Sonoma",
            filters: `${attribute}:"Chevrolet"`,
          }),
        },
      ],
    ];
  });
  expect(calls).toMatchObject(expected);
});
