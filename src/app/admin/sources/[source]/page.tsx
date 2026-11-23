import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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
import { AdminTime } from "~/components/admin/AdminTime";
import { Button } from "~/components/ui/button";
import {
  INGESTION_SOURCE_DISPLAY_NAMES,
  isIngestionSource,
} from "~/lib/ingestion-source";
import { AdminData, SOURCE_PAGE_RUNS } from "~/server/admin/admin-data";
import { readAdminAccess, requireAdmin } from "~/server/admin/require-admin";
import { SourceRun } from "~/server/admin/source-run";
import { IngestionSourceFlags } from "~/server/ingestion/ingestion-source-flags";

type Params = { params: Promise<{ source: string }> };

// Adds nothing for non-admins, as the admin layout's metadata does.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const access = await readAdminAccess();
  const { source } = await params;
  if (access.status === "denied" || !isIngestionSource(source)) return {};
  return { title: INGESTION_SOURCE_DISPLAY_NAMES[source] };
}

export default async function AdminSourcePage({ params }: Params) {
  await requireAdmin();
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
          </Link>
        </Button>
        <AdminPageHeader
          title={name}
          description={`Source key "${source}". Its state, flags and last ${SOURCE_PAGE_RUNS} runs.`}
        />
      </div>

      <WhenLoaded loaded={loaded}>
        {({ summary, runs }) => (
          <>
            <AdminSection
              title="Status"
              description="Failures and the last accepted run count only the runs listed below."
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
                    value: <AdminTime date={summary.lastAcceptedAt} />,
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
                ]}
              />
            </AdminSection>

            <AdminSection
              title="Flags"
              description="What decides whether this source runs and shows. Changing them from here comes in a later update."
            >
              <DetailList
                rows={[
                  {
                    label: "Daily runs",
                    value: summary.retired ? (
                      "Retired: never fetched, whatever the flag says"
                    ) : (
                      <>
                        {FLAG_LABELS[summary.flag]}
                        <span className="text-muted-foreground block text-xs font-normal">
                          Vercel flag {IngestionSourceFlags.key(source)}
                        </span>
                      </>
                    ),
                  },
                  {
                    label: "On the public site",
                    value:
                      summary.hiddenReason === null ? (
                        "Shown"
                      ) : (
                        <>
                          Hidden
                          <span className="text-muted-foreground block text-xs font-normal">
                            {summary.hiddenReason}
                          </span>
                        </>
                      ),
                  },
                ]}
              />
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
