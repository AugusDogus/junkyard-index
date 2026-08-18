import { describe, expect, test } from "bun:test";
import { getHeaderStatusPresentation } from "./header-status";

describe("header status presentation", () => {
  test("describes ingestion failures without claiming provider websites are offline", () => {
    expect(getHeaderStatusPresentation("degraded").message).toBe(
      "Some provider inventory was only partially refreshed during the latest ingestion run. Provider websites may still be available.",
    );
    expect(getHeaderStatusPresentation("down")).toMatchObject({
      title: "Inventory Refresh Failed",
      ariaLabel: "Inventory refresh failed",
      message:
        "Some provider inventory was not refreshed during the latest ingestion run. Provider websites may still be available.",
      icon: "warning",
    });
  });
});
