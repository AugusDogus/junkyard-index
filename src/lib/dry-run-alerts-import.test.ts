import { expect, test } from "bun:test";

test("the alert dry-run CLI imports without database env", async () => {
  const saved = {
    url: process.env.TURSO_DATABASE_URL,
    token: process.env.TURSO_AUTH_TOKEN,
  };
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  try {
    const dryRunAlerts = await import("../../scripts/dry-run-alerts");
    expect(dryRunAlerts.main).toBeFunction();
  } finally {
    if (saved.url !== undefined) process.env.TURSO_DATABASE_URL = saved.url;
    if (saved.token !== undefined) process.env.TURSO_AUTH_TOKEN = saved.token;
  }
});
