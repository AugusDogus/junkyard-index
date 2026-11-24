import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import {
  AdminPageHeader,
  AdminSection,
  DetailList,
  FLAG_LABELS,
  formatChange,
  formatCount,
  formatDuration,
  OutcomeLabel,
  RawText,
  SourceStateBadge,
  WhenLoaded,
} from "~/components/admin/AdminParts";
import { AdminLinkPending } from "~/components/admin/AdminLinkPending";
import { AdminTime } from "~/components/admin/AdminTime";
import { SourceControls } from "~/components/admin/SourceControls";
import { StopRunControl } from "~/components/admin/StopRunControl";
import { Button } from "~/components/ui/button";
import {
  INGESTION_SOURCE_DISPLAY_NAMES,
  isIngestionSource,
} from "~/lib/ingestion-source";
import {
  ADMIN_WINDOW_DAYS,
  AdminData,
  SOURCE_PAGE_ACTIONS,
  SOURCE_PAGE_RUNS,
} from "~/server/admin/admin-data";
import { readAdminAccess, requireAdmin } from "~/server/admin/require-admin";
import {
  RunHold,
  type ActiveRunHold,
  type RunDeployment,
} from "~/server/admin/run-hold";
import { SourceRun } from "~/server/admin/source-run";
import { IngestionSourceFlags } from "~/server/ingestion/ingestion-source-flags";
import type { AdminActionKind } from "~/server/source-control/source-control-repository";

const ACTION_LABELS: Record<AdminActionKind, string> = {
  pause_ingestion: "Paused runs",
  resume_ingestion: "Resumed runs",
  hide_source: "Hid from the site",
  show_source: "Showed on the site",
  run_now: "Started a run",
  abandon_run: "Stopped a run",
};

/** The active run's status rows: what it holds, and the code it runs. */
function holdRows(hold: ActiveRunHold): { label: string; value: ReactNode }[] {
  const rows: { label: string; value: ReactNode }[] = [
    {
      label: "Active run",
      value: (
        <>
          Run {hold.run.runId} at the {hold.run.stage} stage, started{" "}
          <AdminTime date={hold.run.startedAt} />
        </>
      ),
    },
  ];
  if (hold.commit !== null) {
    const { commit } = hold;
    rows.push({
      label: "Publish slot",
      value: (
        <>
          <span className={commit.long ? "text-destructive" : undefined}>
            Held since <AdminTime date={commit.since} /> (
            {formatDuration(commit.heldMs)})
          </span>
          <span className="text-muted-foreground block text-xs font-normal">
            {commit.queue.status === "empty" ? (
              "No other run is waiting for it."
            ) : (
              <>
                {commit.queue.runs} {commit.queue.runs === 1 ? "run" : "runs"}{" "}
                queued behind it, the first since{" "}
                <AdminTime date={commit.queue.since} />. Only one run publishes
                at a time.
              </>
            )}
          </span>
        </>
      ),
    });
  }
  rows.push({
    label: "Code version",
    value: deploymentLabel(hold.deployment),
  });
  return rows;
}

/** Workflow runs keep the code of the deployment they started on. */
function deploymentLabel(deployment: RunDeployment): string {
  switch (deployment.kind) {
    case "current":
      return "Current deployment";
    case "other":
      return `Another deployment (${deployment.deploymentId}): fixes deployed since it started do not reach it`;
    case "unknown":
      return "Unknown: its workflow is not listed as live, or the list could not be read";
  }
}

type Params = { params: Promise<{ source: string }> };

// Adds nothing for non-admins, as the admin layout's metadata does.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const access = await readAdminAccess();
  const { source } = await params;
  if (access.status === "denied" || !isIngestionSource(source)) return {};
  return { title: INGESTION_SOURCE_DISPLAY_NAMES[source] };
}

export default async function AdminSourcePage({ params }: Params) {
  const { userId } = await requireAdmin();
  const { source } = await params;
  if (!isIngestionSource(source)) notFound();
  const loaded = await AdminData.source(source, new Date());
  const name = INGESTION_SOURCE_DISPLAY_NAMES[source];

  return (
    <div className="space-y-12">
      <div>
        <Button asChild variant="link" size="sm" className="mb-4 px-0">
          <Link href="/admin/sources">
            <ArrowLeft data-icon="inline-start" />
            All sources
            <AdminLinkPending />
          </Link>
        </Button>
        <AdminPageHeader
          title={name}
          description={`Source key "${source}". Its state, controls and last ${SOURCE_PAGE_RUNS} runs.`}
        />
      </div>

      <WhenLoaded loaded={loaded}>
        {({ summary, hold, runs, actions }) => (
          <>
            <AdminSection
              title="Status"
              description={`Failures and the last accepted run count the last ${ADMIN_WINDOW_DAYS} days, as on the sources page.`}
            >
              <DetailList
                rows={[
                  {
                    label: "State",
                    value: <SourceStateBadge state={summary.state} />,
                  },
                  {
                    label: "Vehicles on site",
                    value: formatCount(summary.publishedVehicles),
                  },
                  {
                    label: "Change vs previous accepted run",
                    value: formatChange(summary.vehicleChange),
                  },
                  {
                    label: "Failures in a row",
                    value: summary.consecutiveFailures,
                  },
                  {
                    label: "Last accepted",
                    value: (
                      <AdminTime
                        date={summary.lastAcceptedAt}
                        empty={`None in ${ADMIN_WINDOW_DAYS} days`}
                      />
                    ),
                  },
                  ...(summary.stuck === null
                    ? []
                    : [
                        {
                          label: "Stuck run",
                          value: (
                            <>
                              Run {summary.stuck.runId} at the{" "}
                              {summary.stuck.stage} stage, last progress{" "}
                              <AdminTime date={summary.stuck.lastProgressAt} />
                            </>
                          ),
                        },
                      ]),
                  ...(hold === null ? [] : holdRows(hold)),
                ]}
              />
            </AdminSection>

            <AdminSection
              title="Controls"
              description="Changes apply without a deploy and are logged below. A source is paused if it is paused here or by its Vercel flag."
            >
              <SourceControls
                source={source}
                name={name}
                retired={summary.retired}
                ingestion={summary.control.ingestion}
                pausedBy={summary.pausedBy}
                visibility={summary.control.visibility}
              />
              <div className="mt-6">
                <DetailList
                  rows={[
                    {
                      label: "Paused here",
                      value:
                        summary.control.ingestion === "paused" ? "Yes" : "No",
                    },
                    {
                      label: "Vercel flag",
                      value: summary.retired ? (
                        "Retired: never fetched, whatever the flag says"
                      ) : (
                        <>
                          {FLAG_LABELS[summary.flag]}
                          <span className="text-muted-foreground block text-xs font-normal">
                            {IngestionSourceFlags.key(source)}, changed in
                            Vercel
                          </span>
                        </>
                      ),
                    },
                    {
                      label: "Last changed here",
                      value: (
                        <AdminTime
                          date={summary.control.lastChange?.at ?? null}
                          empty="Never"
                        />
                      ),
                    },
                  ]}
                />
              </div>
            </AdminSection>

            <AdminSection
              title="Recent actions"
              description={`The last ${SOURCE_PAGE_ACTIONS} changes made here, newest first. This log cannot be edited.`}
            >
              {actions.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No one has changed this source from here yet.
                </p>
              ) : (
                <ol className="divide-y rounded-lg border">
                  {actions.map((action) => (
                    <li key={action.id} className="grid gap-1 p-4 text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <span className="font-medium">
                          {ACTION_LABELS[action.action]}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          <AdminTime date={action.createdAt} />
                        </span>
                      </div>
                      <p className="text-muted-foreground text-xs break-words">
                        By{" "}
                        {action.userId === userId
                          ? "you"
                          : (action.userName ?? "a removed account")}
                        {action.detail !== null && <>: {action.detail}</>}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </AdminSection>

            <AdminSection
              title="Recent runs"
              description="Newest first. Counts are pages read, vehicles read, unique vehicles kept, duplicates and vehicles rejected by checks."
            >
              {runs.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No runs are stored for this source.
                </p>
              ) : (
                <ol className="divide-y rounded-lg border">
                  {runs.map((run) => {
                    const outcome = SourceRun.outcome(run);
                    const messages = SourceRun.messages(run);
                    const raw =
                      messages.length === 0
                        ? null
                        : `${messages.join("\n")}${run.errorsCutOff ? "\n\n(Cut off: the stored text is longer.)" : ""}`;
                    return (
                      <li key={run.id} className="grid gap-2 p-4 text-sm">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                          <span className="font-medium">
                            <AdminTime date={run.startedAt} />
                          </span>
                          <span>
                            <OutcomeLabel outcome={outcome} />
                            <span className="text-muted-foreground">
                              {" "}
                              (run {run.runStatus}, source {run.status},{" "}
                              {formatDuration(SourceRun.durationMs(run))})
                            </span>
                          </span>
                        </div>
                        <p className="text-muted-foreground text-xs tabular-nums">
                          {run.pagesProcessed.toLocaleString("en-US")} pages,{" "}
                          {run.vehiclesProcessed.toLocaleString("en-US")} read,{" "}
                          {run.uniqueVehicles.toLocaleString("en-US")} unique,{" "}
                          {run.duplicateVehicles.toLocaleString("en-US")}{" "}
                          duplicates,{" "}
                          {run.rejectedVehicles.toLocaleString("en-US")}{" "}
                          rejected
                        </p>
                        {outcome.kind === "rejected" && (
                          <div className="text-xs leading-5">
                            <RawText
                              summary={SourceRun.rejectionSummary(outcome, run)}
                              raw={raw}
                            />
                          </div>
                        )}
                        {outcome.kind !== "rejected" && raw !== null && (
                          <div className="text-muted-foreground text-xs leading-5">
                            <RawText
                              summary="Warnings were recorded."
                              raw={raw}
                              label="Show warnings"
                            />
                          </div>
                        )}
                        {hold !== null &&
                          hold.run.runId === run.runId &&
                          run.runStatus === "running" && (
                            <StopRunControl run={RunHold.stoppable(hold)} />
                          )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </AdminSection>
          </>
        )}
      </WhenLoaded>
    </div>
  );
}
