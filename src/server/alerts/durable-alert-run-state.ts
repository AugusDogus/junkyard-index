export type DurableAlertRunState = {
  status: string;
  stage: string;
  activeSlot: number | null;
  publicationSequence: number | null;
};

export type DurableAlertRunDisposition =
  | { status: "complete" }
  | { status: "stopped" }
  | { status: "ready"; publicationSequence: number }
  | { status: "invalid" };

export function classifyDurableAlertRun(
  run: DurableAlertRunState,
): DurableAlertRunDisposition {
  if (run.status === "success" && run.stage === "released") {
    return { status: "complete" };
  }
  if (run.status !== "running" || run.activeSlot !== 1) {
    return { status: "stopped" };
  }
  if (run.stage !== "match_alerts" || run.publicationSequence === null) {
    return { status: "invalid" };
  }
  return { status: "ready", publicationSequence: run.publicationSequence };
}
