import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { buildByotDirectory } from "./byot-directory-builder";
import { BYOT_QUERIES, BYOT_DAILY_QUERIES } from "./byot-directory";
import { BYOT_YARDS } from "./byot-configuration";
import locations from "./byot-test-fixtures/locations.json";

test("qualified search controls reproduce from the site's own saved make/model menus", () => {
  const controls: unknown = JSON.parse(
    brotliDecompressSync(
      readFileSync(
        new URL("./byot-test-fixtures/directory.json.br", import.meta.url),
      ),
    ).toString(),
  );
  const rebuilt = buildByotDirectory(controls);
  expect(rebuilt).toEqual(BYOT_QUERIES);
  expect(BYOT_DAILY_QUERIES * 7).toBeGreaterThanOrEqual(BYOT_QUERIES.length);
  expect(new Set(BYOT_QUERIES.map((query) => JSON.stringify(query))).size).toBe(
    BYOT_QUERIES.length,
  );
});
test("each configured coordinate pair is published by BYOT and is in the named city", () => {
  const bounds = [
    [31.6, 31.8, -97.2, -97],
    [30.6, 30.8, -96.5, -96.2],
    [30, 30.2, -94.3, -94.1],
    [30.4, 30.5, -91.35, -91.2],
    [32.2, 32.4, -90.3, -90.1],
  ];
  for (const [index, yard] of BYOT_YARDS.entries()) {
    const evidence = Object.values(locations).find((entry) =>
      yard.coordinateSource.startsWith(entry.sourceUrl),
    );
    if (!evidence)
      throw new Error(`Missing native coordinate evidence for ${yard.code}`);
    expect(evidence.geo).toContain(String(yard.lat));
    expect(evidence.geo).toContain(String(yard.lng));
    expect(evidence.address).toContain(yard.city);
    const bound = bounds[index];
    if (!bound) throw new Error("Missing city bounds");
    expect(yard.lat).toBeGreaterThan(bound[0] ?? 0);
    expect(yard.lat).toBeLessThan(bound[1] ?? 0);
    expect(yard.lng).toBeGreaterThan(bound[2] ?? 0);
    expect(yard.lng).toBeLessThan(bound[3] ?? 0);
  }
});
