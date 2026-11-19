import { describe, expect, test } from "bun:test";
import { PendingSaveSearch } from "./pending-save-search";

describe("checkout save-search recovery", () => {
  test("restores expression criteria and keeps the subscription confirmation", () => {
    const url = new URL(
      PendingSaveSearch.checkoutReturnTo({
        query: "",
        filters: {
          expression: "make:Saab AND year:>=1980",
          colors: ["Red"],
          yardTypes: ["full_service"],
        },
      }),
      "https://app.example",
    );
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe("make:Saab AND year:>=1980");
    expect(url.searchParams.get("syntax")).toBe("expression");
    expect(url.searchParams.getAll("colors[]")).toEqual(["Red"]);
    expect(url.searchParams.getAll("yardTypes[]")).toEqual(["full_service"]);
    expect(url.searchParams.get("saveSearch")).toBe("1");
    expect(url.searchParams.get("subscription")).toBe("success");
  });
});
