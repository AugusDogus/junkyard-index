import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { z } from "zod";
import { iisCards, iisOwnedUrl } from "./urgiis-catalog";
import { UrgiisControlSchema } from "./urgiis-schema";
import { assessIisRecord } from "./iis-record";

const probes = z
  .array(
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("model"),
        i: z.number(),
        name: z.string(),
        site: z.object({
          origin: z.string().url(),
          urgid: z.string(),
          pathStyle: z.enum(["parts", "used-parts"]),
        }),
        make: UrgiisControlSchema,
        model: UrgiisControlSchema,
        html: z.string(),
      }),
      z.object({
        kind: z.literal("detail"),
        i: z.number(),
        key: z.string(),
        html: z.string(),
      }),
    ]),
  )
  .parse(
    JSON.parse(
      brotliDecompressSync(
        readFileSync(
          new URL("./urgiis-test-fixtures/probes.json.br", import.meta.url),
        ),
      ).toString(),
    ),
  );
const expectedCards: Readonly<Record<number, number>> = {
  0: 30,
  1: 17,
  2: 0,
  3: 113,
  4: 57,
  5: 99,
  6: 415,
  7: 500,
  8: 406,
  9: 0,
  10: 73,
  11: 500,
  12: 113,
  13: 500,
  14: 25,
  15: 142,
  16: 84,
  17: 30,
  18: 137,
  20: 55,
  21: 85,
};
for (const probe of probes) {
  if (probe.kind !== "model") continue;
  test(`URG IIS parses the saved ${probe.name} donor template`, () => {
    const page = iisCards(probe.html, probe.site);
    expect(page.records.length).toBe(expectedCards[probe.i]);
    expect(page.capped).toBe(page.records.length >= 500);
    expect(page.nativeEmpty).toBe(page.records.length === 0);
    for (const record of page.records) {
      const assessment = assessIisRecord(
        record,
        { kind: "model", make: probe.make, model: probe.model },
        {
          ownedUrl: (r) => iisOwnedUrl(r, probe.site),
          pathStyle: probe.site.pathStyle,
          requireInquiry: false,
        },
      );
      if (assessment.reasons.length === 0) {
        expect(assessment.vin).not.toBeNull();
        expect(assessment.destination).toStartWith(
          probe.site.origin + "/parts/",
        );
      }
    }
  });
}
test("URG IIS saved probes retain shared pools and both empty Nationwide Mercedes pages", () => {
  for (const i of [1, 7, 11, 13, 17]) {
    const probe = probes.find((p) => p.i === i && p.kind === "model");
    if (!probe || probe.kind !== "model")
      throw new Error("Missing shared-pool probe");
    const photoCodes = new Set(
      iisCards(probe.html, probe.site).records.flatMap(
        (r) => r.image?.match(/cloudfront\.net\/([^/]+)\//)?.[1] ?? [],
      ),
    );
    expect(
      [...photoCodes].some(
        (code) => !probe.site.urgid.toLowerCase().split(",").includes(code),
      ),
    ).toBe(true);
  }
  const nationwide = probes.find((p) => p.i === 3 && p.kind === "model");
  if (!nationwide || nationwide.kind !== "model")
    throw new Error("Missing Nationwide site");
  for (const probe of probes.filter((p) => p.i === 3 && p.kind === "detail"))
    expect(iisCards(probe.html, nationwide.site).nativeEmpty).toBe(true);
});
