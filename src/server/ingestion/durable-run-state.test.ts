import { describe, expect, test } from "bun:test";
import { parseAcceptedSources } from "./durable-run-state";

describe("durable ingestion run state", () => {
  test("distinguishes a valid empty accepted-source set from missing state", () => {
    expect(parseAcceptedSources("[]")).toEqual([]);
    expect(() => parseAcceptedSources(null)).toThrow("are missing");
  });

  test("rejects corrupt, unknown, and duplicate accepted sources", () => {
    expect(() => parseAcceptedSources("not-json")).toThrow("are invalid");
    expect(() => parseAcceptedSources('["pyp","unknown"]')).toThrow(
      "are invalid",
    );
    expect(() => parseAcceptedSources('["pyp","pyp"]')).toThrow(
      "must not contain duplicates",
    );
  });
});
