import { describe, expect, test } from "bun:test";
import { SourceRun, type RunOutcome } from "./source-run";

const startedAt = new Date("2026-11-22T08:00:00Z");
const publishedAt = new Date("2026-11-22T10:00:00Z");

function run(
  status: string,
  acceptanceStatus: string,
  runStatus: string,
  inventoryPublishedAt: Date | null,
): SourceRun {
  return {
    id: "source-run",
    runId: "run",
    source: "pyp",
    status,
    acceptanceStatus,
    runStatus,
    stage: "released",
    startedAt,
    completedAt: null,
    inventoryPublishedAt,
    pagesProcessed: 0,
    vehiclesProcessed: 0,
    uniqueVehicles: 0,
    duplicateVehicles: 0,
    rejectedVehicles: 0,
  };
}

describe("SourceRun.outcome", () => {
  // The combinations production stores, as of November 2026.
  const cases: [string, SourceRun, RunOutcome][] = [
    [
      "an errored source in a run that published the rest is rejected",
      run("error", "rejected", "success", publishedAt),
      { kind: "rejected", reason: "error" },
    ],
    [
      "a partial source that failed validation is rejected",
      run("partial", "rejected", "success", publishedAt),
      { kind: "rejected", reason: "validation" },
    ],
    [
      "an accepted source in an abandoned run that published is accepted",
      run("success", "accepted", "abandoned", publishedAt),
      { kind: "accepted", publishedAt },
    ],
    [
      "an accepted source whose snapshot expired before its commit turn is rejected",
      run("success", "expired", "error", null),
      { kind: "rejected", reason: "expired" },
    ],
    [
      "an accepted source whose snapshot was superseded by the next day's crawl is rejected",
      run("success", "superseded", "error", null),
      { kind: "rejected", reason: "superseded" },
    ],
    [
      "an accepted source whose run has not published yet is running",
      run("success", "accepted", "running", null),
      { kind: "running" },
    ],
    [
      "a source still crawling is running",
      run("running", "pending", "running", null),
      { kind: "running" },
    ],
    [
      "an accepted source whose run ended without publishing is rejected",
      run("success", "accepted", "error", null),
      { kind: "rejected", reason: "unpublished" },
    ],
  ];

  for (const [name, input, expected] of cases) {
    test(name, () => {
      expect(SourceRun.outcome(input)).toEqual(expected);
    });
  }
});

describe("SourceRun.messages", () => {
  test("lists source errors, validation errors and run errors once each", () => {
    expect(
      SourceRun.messages({
        errors: JSON.stringify(["crawl failed"]),
        validationErrors: JSON.stringify(["too few vehicles"]),
        runErrors: JSON.stringify(["crawl failed", "commit failed"]),
      }),
    ).toEqual(["crawl failed", "too few vehicles", "commit failed"]);
  });
});

describe("SourceRun.rejectionSummary", () => {
  test("says plainly that an expired run waited too long to publish", () => {
    expect(
      SourceRun.rejectionSummary(
        { kind: "rejected", reason: "expired" },
        {
          errors: null,
          validationErrors: null,
          runErrors: JSON.stringify([
            "The staged snapshot expired after waiting more than 24 hours for the commit turn.",
          ]),
        },
      ),
    ).toBe(
      "It waited over 24 hours for its turn to publish, so nothing was published.",
    );
  });

  test("says plainly that a superseded run was replaced by the next day's crawl", () => {
    expect(
      SourceRun.rejectionSummary(
        { kind: "rejected", reason: "superseded" },
        {
          errors: null,
          validationErrors: null,
          runErrors: JSON.stringify([
            "The staged snapshot was superseded: its ingestion day ended while it waited for the commit turn.",
          ]),
        },
      ),
    ).toBe(
      "Its day ended while it waited for its turn to publish, so the next day's crawl replaced it and nothing was published.",
    );
  });
});
