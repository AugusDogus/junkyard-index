import {
  AdminPageHeader,
  formatChange,
  formatCount,
  OutcomeLabel,
  RawText,
  SourceLink,
  SourceStateBadge,
  WhenLoaded,
} from "~/components/admin/AdminParts";
import { AdminTime } from "~/components/admin/AdminTime";
import { Badge } from "~/components/ui/badge";
import { INVENTORY_HIDDEN_AFTER_DAYS } from "~/lib/inventory-staleness";
import { ADMIN_WINDOW_DAYS, AdminData } from "~/server/admin/admin-data";
import { adminMetadata, requireAdmin } from "~/server/admin/require-admin";
import type { SourceSummary } from "~/server/admin/source-overview";
import type { PauseCause } from "~/server/source-control/source-control";
import {
  NO_SOURCE_RUN_ERRORS,
  SourceRun,
  type SourceRunErrors,
} from "~/server/admin/source-run";

const PAUSE_TITLES: Record<PauseCause, string> = {
  admin: "Paused from its admin page",
  flag: "Paused by its Vercel flag",
  admin_and_flag: "Paused from its admin page and by its Vercel flag",
};

function staleHideReason(hide: { lastAcceptedAt: Date | null }): string {
  const since =
    hide.lastAcceptedAt === null
      ? `in the last ${ADMIN_WINDOW_DAYS} days`
      : `since ${hide.lastAcceptedAt.toISOString()}`;
  return `Hidden automatically: no accepted publication ${since}, over the ${INVENTORY_HIDDEN_AFTER_DAYS}-day limit. It shows again after its next accepted publication.`;
}

export function generateMetadata() {
  return adminMetadata({ title: "Sources" });
}

function LatestOutcome({
  summary,
  errors,
}: {
  summary: SourceSummary;
  errors: SourceRunErrors;
}) {
  const latest = summary.latestRun;
  if (latest === null) {
    return (
      <span className="text-muted-foreground">
        No run in {ADMIN_WINDOW_DAYS} days
      </span>
    );
  }
  const { outcome } = latest;
  if (outcome.kind !== "rejected") return <OutcomeLabel outcome={outcome} />;
  const messages = SourceRun.messages(errors);
  return (
    <div className="max-w-sm">
      <OutcomeLabel outcome={outcome} />
      <div className="text-muted-foreground mt-1 text-xs leading-5">
        <RawText
          summary={SourceRun.rejectionSummary(outcome, errors)}
          raw={messages.length === 0 ? null : messages.join("\n")}
          label="Show error (first part)"
        />
      </div>
    </div>
  );
}

export default async function AdminSourcesPage() {
  await requireAdmin();
  const sources = await AdminData.sources(new Date());

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Sources"
        description={`Every yard feed, problems first. Runs and failures count the last ${ADMIN_WINDOW_DAYS} days. A rejected run publishes nothing, so the source's previous vehicles stay on the site.`}
      />
      <WhenLoaded loaded={sources}>
        {({ summaries, latestErrors }) => (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[60rem] text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Source
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    State
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Last run
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Outcome
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Vehicles on site
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-right font-medium"
                    title="Vehicles found by the last accepted run, minus those found by the accepted run before it"
                  >
                    Change vs previous accepted run
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Failures in a row
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Last accepted
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {summaries.map((summary) => (
                  <tr key={summary.source} className="align-top">
                    <td className="px-3 py-3">
                      <SourceLink source={summary.source}>
                        {summary.name}
                      </SourceLink>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {summary.control.visibility.status === "hidden" && (
                          <Badge
                            variant="outline"
                            title={summary.control.visibility.reason}
                          >
                            Hidden
                          </Badge>
                        )}
                        {summary.staleHide !== null && (
                          <Badge
                            variant="outline"
                            title={staleHideReason(summary.staleHide)}
                          >
                            Hidden (stale)
                          </Badge>
                        )}
                        {summary.pausedBy !== null && (
                          <Badge
                            variant="outline"
                            title={PAUSE_TITLES[summary.pausedBy]}
                          >
                            Paused
                          </Badge>
                        )}
                        {summary.stuck !== null && (
                          <Badge variant="destructive">Stuck</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <SourceStateBadge state={summary.state} />
                    </td>
                    <td className="px-3 py-3 text-xs leading-5">
                      {summary.latestRun === null ? (
                        <span className="text-muted-foreground">None</span>
                      ) : (
                        <>
                          <div>
                            Started{" "}
                            <AdminTime date={summary.latestRun.run.startedAt} />
                          </div>
                          <div>
                            Finished{" "}
                            <AdminTime
                              date={summary.latestRun.run.completedAt}
                              empty="not yet"
                            />
                          </div>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <LatestOutcome
                        summary={summary}
                        errors={
                          summary.latestRun === null
                            ? NO_SOURCE_RUN_ERRORS
                            : (latestErrors.get(summary.latestRun.run.id) ??
                              NO_SOURCE_RUN_ERRORS)
                        }
                      />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatCount(summary.publishedVehicles)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatChange(summary.vehicleChange)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {summary.consecutiveFailures}
                    </td>
                    <td className="px-3 py-3 text-xs leading-5">
                      <AdminTime
                        date={summary.lastAcceptedAt}
                        empty={`None in ${ADMIN_WINDOW_DAYS} days`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </WhenLoaded>
    </div>
  );
}
