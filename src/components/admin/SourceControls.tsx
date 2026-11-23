"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type ReactNode } from "react";
import { applySourceControl } from "~/app/admin/sources/[source]/actions";
import { RawText } from "~/components/admin/AdminParts";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import type { IngestionSource } from "~/lib/ingestion-source";
import {
  HIDE_REASON_MAX_LENGTH,
  type SourceControlInput,
  type SourceControlResult,
} from "~/server/source-control/source-control-action";
import type {
  PauseCause,
  SourceIngestion,
  SourceVisibility,
} from "~/server/source-control/source-control";

/** Which confirm step is open; only one at a time. */
type Confirming = "none" | "hide" | "show" | "run";

const PAUSE_LABELS: Record<PauseCause, string> = {
  admin: "Paused here",
  flag: "Paused by its Vercel flag",
  admin_and_flag: "Paused here and by its Vercel flag",
};

function ControlRow({
  title,
  status,
  children,
}: {
  title: string;
  status: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-3 py-4 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-6">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <div className="text-muted-foreground mt-1 text-sm break-words">
          {status}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-start gap-2">{children}</div>
    </div>
  );
}

export function ResultMessage({ result }: { result: SourceControlResult }) {
  const failed =
    result.status === "failed" ||
    result.status === "refused" ||
    result.status === "invalid";
  return (
    <Alert
      variant={failed ? "destructive" : "default"}
      role="status"
      aria-live="polite"
    >
      <AlertDescription>
        {result.status === "failed" ? (
          <RawText
            summary={result.message}
            raw={result.detail}
            label="Show details"
          />
        ) : (
          result.message
        )}
      </AlertDescription>
    </Alert>
  );
}

/**
 * The owner's controls for one source: pause or resume its runs, hide it
 * from the public site or show it again, and start a run now. Hiding,
 * showing and running ask for a confirm step first.
 */
export function SourceControls({
  source,
  name,
  retired,
  ingestion,
  pausedBy,
  visibility,
}: {
  source: IngestionSource;
  name: string;
  retired: boolean;
  ingestion: SourceIngestion;
  pausedBy: PauseCause | null;
  visibility: SourceVisibility;
}) {
  const router = useRouter();
  const reasonId = useId();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<Confirming>("none");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<SourceControlResult | null>(null);

  function send(input: SourceControlInput) {
    setResult(null);
    startTransition(async () => {
      let next: SourceControlResult;
      try {
        next = await applySourceControl(input);
      } catch (error) {
        // An expired session, a lost connection or a new deploy can stop the
        // request before it answers, so whether it applied is unknown.
        next = {
          status: "failed",
          message:
            "The page lost touch with the server, so it cannot tell whether this happened. Reload the page and check Recent actions before trying again.",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
      setResult(next);
      if (next.status === "done" || next.status === "unchanged") {
        setConfirming("none");
        setReason("");
        router.refresh();
      }
    });
  }

  const runBlocked = retired
    ? "Retired sources are never fetched."
    : pausedBy === "flag"
      ? `Paused by the Vercel flag ingestion-source-${source}. Turn the flag on first.`
      : pausedBy !== null
        ? "Resume it first."
        : null;

  return (
    <div className="grid gap-4">
      <div className="border-border divide-y border-y">
        <ControlRow
          title="Daily runs"
          status={
            retired
              ? "Retired: never fetched"
              : pausedBy === null
                ? "Running"
                : PAUSE_LABELS[pausedBy]
          }
        >
          {ingestion === "paused" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => send({ kind: "resume", source })}
            >
              Resume runs
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={pending || retired}
              onClick={() => send({ kind: "pause", source })}
            >
              Pause runs
            </Button>
          )}
          {pausedBy === "flag" && (
            <p className="text-muted-foreground w-full text-xs">
              Only its Vercel flag pauses it. Turn the flag on in Vercel to run
              it again; pausing here also keeps it paused after that.
            </p>
          )}
        </ControlRow>

        <ControlRow
          title="Public site"
          status={
            visibility.status === "hidden" ? (
              <>
                Hidden
                <span className="block text-xs">{visibility.reason}</span>
              </>
            ) : (
              "Shown"
            )
          }
        >
          {visibility.status === "hidden" ? (
            <>
              {confirming !== "show" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => setConfirming("show")}
                >
                  Show on site
                </Button>
              )}
              {confirming !== "hide" && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    setReason(visibility.reason);
                    setConfirming("hide");
                  }}
                >
                  Change reason
                </Button>
              )}
            </>
          ) : (
            confirming !== "hide" && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setConfirming("hide")}
              >
                Hide from site
              </Button>
            )
          )}
          {confirming === "show" && (
            <div className="grid w-full gap-2">
              <p className="text-sm">
                Show {name} again? Visitors will be linked to its website.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => send({ kind: "show", source })}
                >
                  {pending ? "Showing" : `Show ${name}`}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => setConfirming("none")}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {confirming === "hide" && (
            <form
              className="grid w-full gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                send({ kind: "hide", source, reason });
              }}
            >
              <label htmlFor={reasonId} className="text-sm font-medium">
                Why hide {name}?
              </label>
              <p className="text-muted-foreground text-xs">
                Shown here and in the log, not to visitors. Its vehicles, yards
                and links leave the site; it keeps updating in the background.
              </p>
              <Textarea
                id={reasonId}
                required
                maxLength={HIDE_REASON_MAX_LENGTH}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="min-h-20"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  variant="destructive"
                  size="sm"
                  disabled={pending || reason.trim() === ""}
                >
                  {visibility.status === "hidden"
                    ? pending
                      ? "Saving"
                      : "Save reason"
                    : pending
                      ? "Hiding"
                      : `Hide ${name}`}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => setConfirming("none")}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </ControlRow>

        <ControlRow
          title="Run now"
          status={
            runBlocked ??
            "Starts one run outside the daily pass. It counts as one of today's attempts."
          }
        >
          {confirming === "run" ? (
            <div className="grid w-full gap-2">
              <p className="text-sm">Start a run of {name} now?</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => send({ kind: "run", source })}
                >
                  {pending ? "Starting" : "Start run"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => setConfirming("none")}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={pending || runBlocked !== null}
              onClick={() => setConfirming("run")}
            >
              Run now
            </Button>
          )}
        </ControlRow>
      </div>

      {pending && (
        <p className="text-muted-foreground text-sm" role="status">
          Saving. This can take a few seconds.
        </p>
      )}
      {result !== null && <ResultMessage result={result} />}
    </div>
  );
}
