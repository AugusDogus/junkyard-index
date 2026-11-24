import { Checkbox } from "~/components/ui/checkbox";
import type { StoppableRun } from "~/server/admin/run-hold";
import type { InPlaceStage } from "~/server/ingestion/algolia-inplace-rebuild";
import { IngestionSchedule } from "~/server/ingestion/ingestion-schedule";
import { RunAbandonment } from "~/server/ingestion/run-abandonment";

/**
 * What stopping a run would do. Refused: its Algolia index move is not
 * confirmed yet, so it cannot be stopped. A run past its crawl needs a full
 * search rebuild confirmed first.
 */
export type StopRunPlan =
  | { kind: "refused"; message: string }
  | { kind: "stop"; fullRebuild: boolean };

export function stopRunPlan(run: StoppableRun): StopRunPlan {
  const check = RunAbandonment.check({
    runId: run.runId,
    stage: run.stage,
    force: true,
  });
  return check.status === "allowed"
    ? { kind: "stop", fullRebuild: check.fullRebuild }
    : { kind: "refused", message: check.message };
}

const RETRY_HOURS = IngestionSchedule.retryDelayMs / (60 * 60 * 1000);

/** InPlaceRebuild.stages, listed here to keep its server imports out. */
const IN_PLACE_STAGES: readonly InPlaceStage[] = [
  "full_reindex_inplace_load",
  "full_reindex_inplace_sweep",
];

/** The confirm dialog's plain account of what stopping the run does. */
export function stopRunConsequences(
  run: StoppableRun,
  fullRebuild: boolean,
): string[] {
  return [
    `Run ${run.runId} is abandoned and its workflow is cancelled.`,
    "Runs queued behind it go ahead and can publish.",
    "Vehicles it already published stay; its unpublished crawl data and any temporary search copy are discarded.",
    run.source === null
      ? "Its sources' next scheduled runs are started by the ingestion pass, on the code that pass started on."
      : `${run.name}'s next scheduled retry comes ${RETRY_HOURS} hours after the stop while it has attempts left today (${IngestionSchedule.maxAttemptsPerDay(run.source)} a day), otherwise in tomorrow's daily pass. Today's ingestion pass starts that retry on the code the pass started on, which may be older than current code.`,
    ...(run.source !== null && run.deployment.kind === "other"
      ? [
          `This run is on another deployment (${run.deployment.deploymentId}), so a retry today may run that same old code. Use Stop and run again to restart it on current code now.`,
        ]
      : []),
    ...(fullRebuild
      ? [
          `It is at the ${run.stage} stage, past its crawl, so it may have written part of its data. A full search rebuild runs next, rewriting every vehicle in search.`,
          ...(IN_PLACE_STAGES.some((stage) => stage === run.stage)
            ? [
                "Stopping discards this in-place rebuild's progress. The next run restarts it from the first vehicle, repeating hours of work and the sweep's Algolia browse requests, which count toward the plan's search requests. Check the search request budget first (docs/runbooks/full-reindex.md).",
              ]
            : []),
          ...otherCodeRebuild(run.otherCode),
        ]
      : []),
  ];
}

/**
 * The full rebuild runs in whichever active run claims the commit next, on
 * that run's code. Runs on a deployment from before a rebuild fix repeat the
 * old failure (on Nov 23, a copy over the record cap looped).
 */
function otherCodeRebuild(otherCode: StoppableRun["otherCode"]): string[] {
  const parts = [
    ...(otherCode.other > 0
      ? [
          `${otherCode.other} on another deployment (${otherCode.deploymentIds.join(", ")})`,
        ]
      : []),
    ...(otherCode.unknown > 0
      ? [`${otherCode.unknown} on an unknown deployment`]
      : []),
  ];
  if (parts.length === 0) return [];
  const runs = otherCode.other + otherCode.unknown;
  return [
    `${runs === 1 ? "1 other active run is" : `${runs} other active runs are`} not on current code: ${parts.join(" and ")}. The first of them to claim the publish slot performs that rebuild with its own code, which may predate fixes. Cancel their workflows in Vercel before stopping this run (docs/runbooks/full-reindex.md).`,
  ];
}

/** The body of the stop dialog: what happens, and the rebuild confirm. */
export function StopRunDetails({
  run,
  plan,
  rebuildConfirmed,
  onRebuildConfirmed,
  checkboxId,
}: {
  run: StoppableRun;
  plan: StopRunPlan;
  rebuildConfirmed: boolean;
  onRebuildConfirmed: (confirmed: boolean) => void;
  checkboxId: string;
}) {
  if (plan.kind === "refused") {
    return <p className="text-destructive text-sm">{plan.message}</p>;
  }
  return (
    <div className="grid gap-3 text-sm">
      <ul className="list-disc space-y-1 pl-5">
        {stopRunConsequences(run, plan.fullRebuild).map((sentence) => (
          <li key={sentence}>{sentence}</li>
        ))}
      </ul>
      {run.source !== null && (
        <p className="text-muted-foreground text-xs">
          Stop and run again starts a fresh run of {run.name} on current code
          right away instead, as Run now does. It counts as one of today&apos;s
          attempts.
        </p>
      )}
      {plan.fullRebuild && (
        <div className="flex items-start gap-2">
          <Checkbox
            id={checkboxId}
            checked={rebuildConfirmed}
            onCheckedChange={(checked) => onRebuildConfirmed(checked === true)}
          />
          <label htmlFor={checkboxId} className="text-sm leading-4 font-medium">
            I understand a full search rebuild will run.
          </label>
        </div>
      )}
    </div>
  );
}
