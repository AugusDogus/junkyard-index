import { describe, expect, test } from "bun:test";
import {
  getIngestionStatusMessage,
  mapRunStatus,
  parseErrors,
  worstStatus,
  type IngestionStatus,
} from "./status-utils";

describe("status helpers", () => {
  test("describes ingestion failures without claiming provider websites are offline", () => {
    expect(getIngestionStatusMessage("degraded")).toBe(
      "Some provider inventory was only partially refreshed during the latest ingestion run. Provider websites may still be available.",
    );
    expect(getIngestionStatusMessage("down")).toBe(
      "Some provider inventory was not refreshed during the latest ingestion run. Provider websites may still be available.",
    );
  });

  test("maps source run statuses to public ingestion statuses", () => {
    expect(mapRunStatus("success")).toBe("operational");
    expect(mapRunStatus("running")).toBe("in_progress");
    expect(mapRunStatus("partial")).toBe("degraded");
    expect(mapRunStatus("error")).toBe("down");
    expect(mapRunStatus("unexpected")).toBe("down");
  });

  test("picks the worst status from a list", () => {
    const statuses: IngestionStatus[] = ["operational", "degraded", "down"];
    expect(worstStatus(statuses)).toBe("down");
    expect(worstStatus(["in_progress", "operational"])).toBe("in_progress");
    expect(worstStatus(["in_progress", "degraded", "down"])).toBe("down");
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
