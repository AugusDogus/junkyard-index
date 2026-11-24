import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { StoppableRun } from "~/server/admin/run-hold";
import { StopRunDetails, stopRunPlan } from "./StopRunDetails";

const crawling: StoppableRun = {
  runId: "run-1",
  name: "Hollander Stores",
  source: "hollanderstores",
  stage: "sources",
  deployment: { kind: "current" },
  otherCode: { other: 0, deploymentIds: [], unknown: 0 },
};

function render(run: StoppableRun, rebuildConfirmed = false): string {
  return renderToStaticMarkup(
    <StopRunDetails
      run={run}
      plan={stopRunPlan(run)}
      rebuildConfirmed={rebuildConfirmed}
      onRebuildConfirmed={() => undefined}
      checkboxId="confirm"
    />,
  )
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
}

describe("StopRunDetails", () => {
  test("a crawling run says what stopping does, with no rebuild to confirm", () => {
    const text = render(crawling);
    expect(text).toContain(
      "Run run-1 is abandoned and its workflow is cancelled.",
    );
    expect(text).toContain("Runs queued behind it go ahead and can publish.");
    expect(text).toContain(
      "Vehicles it already published stay; its unpublished crawl data and any temporary search copy are discarded.",
    );
    expect(text).toContain(
      "Hollander Stores's next scheduled retry comes 2 hours after the stop while it has attempts left today (3 a day), otherwise in tomorrow's daily pass. Today's ingestion pass starts that retry on the code the pass started on, which may be older than current code.",
    );
    expect(text).toContain(
      "Stop and run again starts a fresh run of Hollander Stores on current code right away instead",
    );
    expect(text).not.toContain("another deployment");
    expect(text).not.toContain("full search rebuild");
  });

  test("a run on another deployment says a retry today may run that same old code", () => {
    const text = render({
      ...crawling,
      deployment: { kind: "other", deploymentId: "dpl_old" },
    });
    expect(text).toContain(
      "This run is on another deployment (dpl_old), so a retry today may run that same old code. Use Stop and run again to restart it on current code now.",
    );
  });

  test("a run past its crawl warns of the full rebuild and asks to confirm it", () => {
    const run = { ...crawling, stage: "reconcile_upsert" };
    expect(stopRunPlan(run)).toEqual({ kind: "stop", fullRebuild: true });
    const text = render(run);
    expect(text).toContain(
      "It is at the reconcile_upsert stage, past its crawl, so it may have written part of its data. A full search rebuild runs next",
    );
    expect(text).toContain("I understand a full search rebuild will run.");
    expect(
      renderToStaticMarkup(
        <StopRunDetails
          run={run}
          plan={stopRunPlan(run)}
          rebuildConfirmed
          onRebuildConfirmed={() => undefined}
          checkboxId="confirm"
        />,
      ),
    ).toContain('aria-checked="true"');
  });

  test("a forced stop warns that runs on older code would perform the rebuild", () => {
    const text = render({
      ...crawling,
      stage: "full_reindex_load",
      otherCode: { other: 21, deploymentIds: ["dpl_old"], unknown: 1 },
    });
    expect(text).toContain(
      "22 other active runs are not on current code: 21 on another deployment (dpl_old) and 1 on an unknown deployment. The first of them to claim the publish slot performs that rebuild with its own code, which may predate fixes. Cancel their workflows in Vercel before stopping this run (docs/runbooks/full-reindex.md).",
    );
    expect(
      render({
        ...crawling,
        otherCode: { other: 21, deploymentIds: ["dpl_old"], unknown: 0 },
      }),
    ).not.toContain("not on current code");
  });

  test("stopping an in-place rebuild says its progress is discarded", () => {
    const sentence = "Stopping discards this in-place rebuild's progress.";
    expect(
      render({ ...crawling, stage: "full_reindex_inplace_sweep" }),
    ).toContain(sentence);
    expect(render({ ...crawling, stage: "full_reindex_load" })).not.toContain(
      sentence,
    );
  });

  test("an unconfirmed Algolia move shows why it cannot be stopped", () => {
    const run = { ...crawling, stage: "full_reindex_move_pending" };
    expect(stopRunPlan(run).kind).toBe("refused");
    expect(render(run).trim()).toBe(
      "Run run-1 has an unconfirmed Algolia index move and cannot be abandoned. Retry after Algolia publication is confirmed.",
    );
  });

  test("a run across every source offers no run again", () => {
    const text = render({ ...crawling, source: null, name: "Every source" });
    expect(text).toContain(
      "Its sources' next scheduled runs are started by the ingestion pass, on the code that pass started on.",
    );
    expect(text).not.toContain("Stop and run again");
  });
});
