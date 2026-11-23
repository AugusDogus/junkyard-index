"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { stopIngestionRun } from "~/app/admin/actions";
import { ResultMessage } from "~/components/admin/SourceControls";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import type { StoppableRun } from "~/server/admin/run-hold";
import type { StopRunInput } from "~/server/admin/stop-run-action";
import type { SourceControlResult } from "~/server/source-control/source-control-action";
import { StopRunDetails, stopRunPlan } from "./StopRunDetails";

/**
 * "Stop this run": a confirm dialog that says what stopping does, then
 * abandons the run through the stop action. A run past its crawl needs the
 * full search rebuild confirmed first.
 */
export function StopRunControl({ run }: { run: StoppableRun }) {
  const router = useRouter();
  const checkboxId = useId();
  const [open, setOpen] = useState(false);
  const [rebuildConfirmed, setRebuildConfirmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SourceControlResult | null>(null);
  const plan = stopRunPlan(run);
  const blocked =
    plan.kind === "refused" || (plan.fullRebuild && !rebuildConfirmed);

  function send(kind: StopRunInput["kind"]) {
    if (plan.kind === "refused") return;
    setResult(null);
    startTransition(async () => {
      let next: SourceControlResult;
      try {
        next = await stopIngestionRun({
          kind,
          runId: run.runId,
          force: plan.fullRebuild,
        });
      } catch (error) {
        next = {
          status: "failed",
          message:
            "The page lost touch with the server, so it cannot tell whether the run was stopped. Reload the page and check Recent runs before trying again.",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
      setResult(next);
      // The page is not refreshed here: the stopped run's row loses this
      // control, and its result message with it.
      if (next.status === "done" || next.status === "unchanged") {
        setOpen(false);
        setRebuildConfirmed(false);
      }
    });
  }

  return (
    <div className="grid gap-2">
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return;
          setOpen(next);
          if (next) setResult(null);
        }}
      >
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="justify-self-start">
            Stop this run
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop {run.name}&apos;s run?</DialogTitle>
            <DialogDescription>
              Use this when the run is stuck or holding other runs up.
            </DialogDescription>
          </DialogHeader>
          <StopRunDetails
            run={run}
            plan={plan}
            rebuildConfirmed={rebuildConfirmed}
            onRebuildConfirmed={setRebuildConfirmed}
            checkboxId={checkboxId}
          />
          {open && result !== null && <ResultMessage result={result} />}
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            {run.source !== null && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending || blocked}
                onClick={() => send("stop_and_run")}
              >
                Stop and run again
              </Button>
            )}
            <Button
              variant="destructive"
              size="sm"
              disabled={pending || blocked}
              onClick={() => send("stop")}
            >
              {pending ? "Stopping" : "Stop run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {!open && result !== null && (
        <>
          <ResultMessage result={result} />
          <Button
            variant="link"
            size="sm"
            className="justify-self-start px-0"
            onClick={() => router.refresh()}
          >
            Reload the page
          </Button>
        </>
      )}
    </div>
  );
}
