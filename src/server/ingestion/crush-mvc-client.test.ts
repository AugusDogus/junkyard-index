import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  CrushMvcMakesResponseSchema,
  CrushMvcModelsResponseSchema,
} from "./crush-mvc-client";

function fixtureUrl(fileName: string): URL {
  return new URL(`./fixtures/${fileName}`, import.meta.url);
}

describe("CrushMvcMakesResponseSchema", () => {
  test("decodes the live GetMakes payload from Pick-A-Part Jalopy Jungle", async () => {
    const text = await Bun.file(
      fixtureUrl("crush-mvc-pickapart-jalopy-jungle-makes.json"),
    ).text();
    const makes = await Effect.runPromise(
      Schema.decodeUnknown(CrushMvcMakesResponseSchema)(JSON.parse(text)),
    );

    expect(makes.length).toBeGreaterThan(20);
    expect(makes[0]).toEqual({ makeName: "ACURA" });
    expect(makes.some((make) => make.makeName === "FORD")).toBe(true);
  });
});

describe("CrushMvcModelsResponseSchema", () => {
  test("decodes the live GetModels payload from Pick-A-Part Jalopy Jungle", async () => {
    const text = await Bun.file(
      fixtureUrl("crush-mvc-pickapart-jalopy-jungle-models.json"),
    ).text();
    const models = await Effect.runPromise(
      Schema.decodeUnknown(CrushMvcModelsResponseSchema)(JSON.parse(text)),
    );

    expect(models[0]).toEqual({ model: "AEROSTAR" });
    expect(models.some((model) => model.model === "FUSION")).toBe(true);
  });

  test("rejects payloads that are not make/model arrays", async () => {
    const result = await Effect.runPromiseExit(
      Schema.decodeUnknown(CrushMvcMakesResponseSchema)({
        error: "not found",
      }),
    );
    expect(result._tag).toBe("Failure");
  });
});
