import { describe, expect, test } from "bun:test";
import {
  mapRunStatus,
  parseErrors,
  worstStatus,
  type IngestionStatus,
} from "./status";

describe("status helpers", () => {
  test("maps source run statuses to public ingestion statuses", () => {
    expect(mapRunStatus("success")).toBe("operational");
    expect(mapRunStatus("partial")).toBe("degraded");
    expect(mapRunStatus("error")).toBe("down");
    expect(mapRunStatus("unexpected")).toBe("operational");
  });

  test("picks the worst status from a list", () => {
    const statuses: IngestionStatus[] = ["operational", "degraded", "down"];
    expect(worstStatus(statuses)).toBe("down");
    expect(worstStatus(["operational", "degraded"])).toBe("degraded");
    expect(worstStatus(["operational"])).toBe("operational");
  });

  test("parses JSON string arrays and filters non-string values", () => {
    expect(parseErrors('["a","b",1,false]')).toEqual(["a", "b"]);
  });

  test("returns null for null, invalid JSON, or non-array payloads", () => {
    expect(parseErrors(null)).toBeNull();
    expect(parseErrors("{bad json")).toBeNull();
    expect(parseErrors('{"error":"x"}')).toBeNull();
  });
});
