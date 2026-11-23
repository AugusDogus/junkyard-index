import { describe, expect, test } from "bun:test";
import { RunAbandonment } from "./run-abandonment";

describe("RunAbandonment.check", () => {
  test("a run still crawling stops without a search rebuild, forced or not", () => {
    for (const force of [false, true]) {
      expect(
        RunAbandonment.check({ runId: "run-1", stage: "sources", force }),
      ).toEqual({ status: "allowed", fullRebuild: false });
    }
  });

  test("a run past its crawl needs force, which mandates a full rebuild", () => {
    expect(
      RunAbandonment.check({
        runId: "run-1",
        stage: "reconcile_missing",
        force: false,
      }),
    ).toEqual({
      status: "force_required",
      message:
        "Run run-1 entered reconcile_missing; force is required and will mandate a full Algolia rebuild.",
    });
    expect(
      RunAbandonment.check({
        runId: "run-1",
        stage: "reconcile_missing",
        force: true,
      }),
    ).toEqual({ status: "allowed", fullRebuild: true });
  });

  test("an unconfirmed Algolia move is refused even when forced", () => {
    expect(
      RunAbandonment.check({
        runId: "run-1",
        stage: "full_reindex_move_pending",
        force: true,
      }),
    ).toEqual({
      status: "move_pending",
      message:
        "Run run-1 has an unconfirmed Algolia index move and cannot be abandoned. Retry after Algolia publication is confirmed.",
    });
  });
});
