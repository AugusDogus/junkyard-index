import { expect, test } from "bun:test";
import { INVENTORY_HIDDEN_AFTER_DAYS } from "~/lib/inventory-staleness";
import { SOURCE_FRESHNESS_LOOKBACK_DAYS } from "~/server/ingestion/durable-health";
import { ADMIN_WINDOW_DAYS } from "./admin-window";

test("admin reads at least the public freshness lookback, so its Hidden (stale) badge matches what the site hides", () => {
  expect(ADMIN_WINDOW_DAYS).toBeGreaterThanOrEqual(
    SOURCE_FRESHNESS_LOOKBACK_DAYS,
  );
  expect(SOURCE_FRESHNESS_LOOKBACK_DAYS).toBeGreaterThan(
    INVENTORY_HIDDEN_AFTER_DAYS,
  );
});
