import { describe, expect, test } from "bun:test";
import { GET } from "./route";

describe("checkout return", () => {
  test("removes Polar's customer session token before rendering search", () => {
    const response = GET(
      new Request(
        "https://app.example/api/billing/checkout-return?customer_session_token=secret&other=value",
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://app.example/search?subscription=success",
    );
    expect(response.headers.get("location")).not.toContain(
      "customer_session_token",
    );
  });
});
