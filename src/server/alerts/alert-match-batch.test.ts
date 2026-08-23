import { describe, expect, test } from "bun:test";
import {
  processAlertMatchBatch,
  QuarantinedAlertMatchError,
} from "./alert-match-batch";

describe("durable alert matching batches", () => {
  test("records a poison search and continues matching later searches", async () => {
    const matched: string[] = [];
    const failures: string[] = [];
    const intentsCreated = await processAlertMatchBatch(
      [{ id: "broad-search" }, { id: "healthy-search" }],
      {
        match: async (search) => {
          matched.push(search.id);
          if (search.id === "broad-search") {
            throw new QuarantinedAlertMatchError("pagination-limit");
          }
          return 2;
        },
        recordFailure: async (search) => {
          failures.push(search.id);
        },
      },
    );

    expect(matched).toEqual(["broad-search", "healthy-search"]);
    expect(failures).toEqual(["broad-search"]);
    expect(intentsCreated).toBe(2);
  });

  test("stops the batch on a retryable infrastructure failure", async () => {
    const matched: string[] = [];
    await expect(
      processAlertMatchBatch(
        [{ id: "failing-search" }, { id: "must-not-run" }],
        {
          match: async (search) => {
            matched.push(search.id);
            throw new Error("Turso unavailable");
          },
          recordFailure: async () => undefined,
        },
      ),
    ).rejects.toThrow("Turso unavailable");
    expect(matched).toEqual(["failing-search"]);
  });
});
