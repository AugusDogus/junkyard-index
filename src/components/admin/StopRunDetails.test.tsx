import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { StoppableRun } from "~/server/admin/run-hold";
import { StopRunDetails, stopRunPlan } from "./StopRunDetails";

const crawling: StoppableRun = {
  runId: "run-1",
  name: "Hollander Stores",
  source: "hollanderstores",
  stage: "sources",
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
    expect(text).toContain("Data it already wrote stays; nothing is deleted.");
    expect(text).toContain(
      "Hollander Stores's next scheduled run starts fresh on current code: 2 hours after the stop while it has attempts left today (3 a day), otherwise in tomorrow's daily pass.",
    );
    expect(text).toContain("Stop and run again starts a fresh run");
    expect(text).not.toContain("full search rebuild");
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
      "Its sources' next scheduled runs start fresh on current code.",
    );
    expect(text).not.toContain("Stop and run again");
  });
});
