import { describe, expect, test } from "bun:test";
import { worstStatus, type IngestionStatus } from "./status-utils";

describe("status helpers", () => {
  test("picks the worst status from a list", () => {
    const statuses: IngestionStatus[] = ["operational", "degraded", "down"];
    expect(worstStatus(statuses)).toBe("down");
    expect(worstStatus(["in_progress", "operational"])).toBe("in_progress");
    expect(worstStatus(["in_progress", "degraded", "down"])).toBe("down");
    expect(worstStatus(["operational", "degraded"])).toBe("degraded");
    expect(worstStatus(["operational"])).toBe("operational");
  });
});
