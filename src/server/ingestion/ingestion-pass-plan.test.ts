import { describe, expect, test } from "bun:test";
import type { DurableIngestionWakeupRun } from "./durable-ingestion-types";
import { STOPPED_CHUNK_MS } from "./durable-ingestion-repository";
import { HostClaims } from "./host-claims";
import { ingestionPassPlan } from "./ingestion-pass-plan";
import { SourceHostClaims } from "./source-host-claims";

const run = (
  runId: string,
  source: string,
  fields: Partial<DurableIngestionWakeupRun> = {},
): DurableIngestionWakeupRun => ({
  action: "resume",
  runId,
  source,
  fetching: true,
  attached: false,
  tenantsDone: 0,
  ...fields,
});

describe("ingestionPassPlan", () => {
  test("claims a waiting URG IIS run's next tenant and an attached one's remaining tenants", () => {
    const plan = ingestionPassPlan({
      status: "active",
      runs: [
        run("waiting", "urgiis", { tenantsDone: 3 }),
        run("attached", "urgiis", { tenantsDone: 3, attached: true }),
      ],
      stopped: [],
      retryAt: null,
    });

    expect(plan).toEqual({
      status: "active",
      runs: [
        {
          runId: "waiting",
          claims: SourceHostClaims.next("urgiis", 3),
          started: false,
        },
        {
          runId: "attached",
          claims: SourceHostClaims.held("urgiis", 3),
          started: true,
        },
      ],
      held: [],
      retryAt: null,
    });
  });

  test("claims nothing for a run past fetching or across every source", () => {
    const plan = ingestionPassPlan({
      status: "active",
      runs: [
        run("staged", "pratt", { fetching: false, attached: true }),
        run("local", "all"),
      ],
      stopped: [],
      retryAt: null,
    });

    expect(
      plan.status === "active" &&
        plan.runs.every((planned) => HostClaims.isNone(planned.claims)),
    ).toBe(true);
  });

  test("holds a stopped run's hosts and plans again when they free up", () => {
    expect(
      ingestionPassPlan({
        status: "active",
        runs: [run("again", "pratt")],
        stopped: [{ source: "pratt", releasedAt: 1_000 }],
        retryAt: 9_000_000,
      }),
    ).toMatchObject({
      held: [SourceHostClaims.of("pratt")],
      retryAt: 1_000 + STOPPED_CHUNK_MS,
    });
  });

  test("passes waiting and complete wakeups through", () => {
    expect(ingestionPassPlan({ status: "waiting", retryAt: 5 })).toEqual({
      status: "waiting",
      retryAt: 5,
    });
    expect(ingestionPassPlan({ status: "complete" })).toEqual({
      status: "complete",
    });
  });
});
