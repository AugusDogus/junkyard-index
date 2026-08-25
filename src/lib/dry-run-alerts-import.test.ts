import { expect, test } from "bun:test";

test("the alert dry-run CLI imports outside the Next.js server runtime", async () => {
  const dryRunAlerts = await import("../../scripts/dry-run-alerts");
  expect(dryRunAlerts.main).toBeFunction();
});
