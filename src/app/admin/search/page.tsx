import {
  AdminPageHeader,
  AdminSection,
  DetailList,
  formatCount,
  RawText,
  WhenLoaded,
} from "~/components/admin/AdminParts";
import { AdminTime } from "~/components/admin/AdminTime";
import {
  alertCheckStatusText,
  publicationResultText,
  SearchBacklogText,
  searchStatusText,
} from "~/components/admin/SearchParts";
import {
  INGESTION_SOURCE_DISPLAY_NAMES,
  isIngestionSource,
} from "~/lib/ingestion-source";
import {
  ADMIN_WINDOW_DAYS,
  AdminData,
  SEARCH_PAGE_PUBLICATIONS,
} from "~/server/admin/admin-data";
import type { ChannelCounts } from "~/server/admin/alert-check-overview";
import { adminMetadata, requireAdmin } from "~/server/admin/require-admin";
import { SearchAlertsFlag } from "~/server/alerts/search-alerts-flag";

export function generateMetadata() {
  return adminMetadata({ title: "Search & alerts" });
}

function sourceName(source: string): string {
  // Runs from before per-source runs covered every source at once.
  if (source === "all") return "Every source";
  return isIngestionSource(source)
    ? INGESTION_SOURCE_DISPLAY_NAMES[source]
    : source;
}

function channelText(counts: ChannelCounts): string {
  const parts = [`${counts.delivered} sent`];
  if (counts.waiting > 0) parts.push(`${counts.waiting} waiting`);
  if (counts.retrying > 0) parts.push(`${counts.retrying} failed, retrying`);
  if (counts.cancelled > 0) parts.push(`${counts.cancelled} cancelled`);
  if (counts.other > 0) parts.push(`${counts.other} in another state`);
  return parts.join(", ");
}

export default async function AdminSearchPage() {
  await requireAdmin();
  const now = new Date();
  const [search, alerts] = await Promise.all([
    AdminData.search(now),
    AdminData.alerts(now),
  ]);

  return (
    <div className="space-y-12">
      <AdminPageHeader
        title="Search & alerts"
        description="Whether new inventory is reaching search, and whether saved-search alerts are going out. Read from the database only; nothing here searches Algolia."
      />

      <AdminSection title="Search updates">
        <WhenLoaded loaded={search}>
          {({ overview }) => {
            const { status, backlog } = overview;
            return (
              <div className="space-y-4">
                <RawText
                  summary={
                    <p className="text-sm">
                      {overview.problems.length > 0
                        ? "Search needs a look: newly found vehicles may be missing from results."
                        : searchStatusText(status)}
                    </p>
                  }
                  raw={
                    overview.problems.length === 0
                      ? null
                      : overview.problems.join("\n")
                  }
                />
                <DetailList
                  rows={[
                    {
                      label: "Who updates search",
                      value:
                        status.status === "inline"
                          ? "Each yard's run (inline)"
                          : status.mode === "unavailable"
                            ? "Unknown: the publication mode flag could not be read"
                            : "The search updater (decoupled)",
                    },
                    {
                      label: "Search updater flag",
                      value: overview.projector === "enabled" ? "On" : "Paused",
                    },
                    {
                      label: "Last search update",
                      value: (
                        <AdminTime date={overview.newestSearchPublishedAt} />
                      ),
                    },
                    {
                      label: "Changes waiting for search",
                      value: (
                        <>
                          <SearchBacklogText backlog={backlog} />
                          {backlog.kind === "inline" &&
                            backlog.oldestCreatedAt !== null && (
                              <span className="text-muted-foreground block text-xs font-normal">
                                Oldest waiting since{" "}
                                <AdminTime date={backlog.oldestCreatedAt} />
                              </span>
                            )}
                          {backlog.kind === "decoupled" &&
                            backlog.count > 0 && (
                              <span className="text-muted-foreground block text-xs font-normal">
                                Oldest has waited{" "}
                                {Math.round(backlog.lagMs / 60_000)} min
                              </span>
                            )}
                        </>
                      ),
                    },
                    {
                      label: "Full rebuild needed",
                      value: overview.fullReindexRequired ? "Yes" : "No",
                    },
                    ...(status.status === "inline"
                      ? []
                      : [
                          {
                            label: "Updater circuit",
                            value:
                              status.circuit.state === "closed"
                                ? "Working"
                                : `${status.circuit.state === "open" ? "Stopped" : "Testing"} after ${status.circuit.failureCount} failure(s)${status.circuit.lastErrorTag === null ? "" : ` (${status.circuit.lastErrorTag})`}`,
                          },
                          {
                            label: "Live index built",
                            value: (
                              <AdminTime
                                date={
                                  status.liveGeneration?.liveAt
                                    ? new Date(status.liveGeneration.liveAt)
                                    : null
                                }
                                empty="No live index recorded"
                              />
                            ),
                          },
                        ]),
                  ]}
                />
              </div>
            );
          }}
        </WhenLoaded>
      </AdminSection>

      <AdminSection
        title="Recent search updates"
        description={`The last ${SEARCH_PAGE_PUBLICATIONS} runs that updated search. "Rejected, previous vehicles kept" means that source's run failed, so search kept its vehicles from before. "Some sources left out" (older runs of every source at once) means the run published while some sources failed.`}
      >
        <WhenLoaded loaded={search}>
          {({ publications }) =>
            publications.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No search updates are stored.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead className="bg-muted/50 text-muted-foreground text-xs">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Search updated
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Run
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-right font-medium"
                      >
                        Vehicles on site
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Result
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {publications.map((publication) => (
                      <tr key={publication.runId}>
                        <td className="px-3 py-2 text-xs">
                          <AdminTime date={publication.searchPublishedAt} />
                        </td>
                        <td className="px-3 py-2">
                          {sourceName(publication.source)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCount(publication.publishedVehicleCount)}
                        </td>
                        <td className="px-3 py-2">
                          {publicationResultText(publication)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </WhenLoaded>
      </AdminSection>

      <AdminSection
        title="Saved-search alerts"
        description={`One alert check runs per day and queues emails and Discord messages. The last ${ADMIN_WINDOW_DAYS} days.`}
      >
        <WhenLoaded loaded={alerts}>
          {({ mode, status, checks }) => (
            <div className="space-y-4">
              <DetailList
                rows={[
                  {
                    label: "Alerts",
                    value: (
                      <>
                        {mode === "enabled"
                          ? "On"
                          : "Paused: no checks run and nothing is sent"}
                        <span className="text-muted-foreground block text-xs font-normal">
                          Vercel flag {SearchAlertsFlag.key}
                        </span>
                      </>
                    ),
                  },
                  {
                    label: "Health",
                    value:
                      status.status === "unhealthy" ? (
                        <RawText
                          summary="Behind: subscribers may not be getting alerts."
                          raw={status.problems.join("\n")}
                          label="Show details"
                        />
                      ) : status.status === "paused" ? (
                        "Not checked while paused"
                      ) : (
                        "On schedule"
                      ),
                  },
                ]}
              />
              {checks.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No alert checks in the last {ADMIN_WINDOW_DAYS} days.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[40rem] text-left text-sm">
                    <thead className="bg-muted/50 text-muted-foreground text-xs">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Day
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Check
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Email
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Discord
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {checks.map((check) => (
                        <tr key={check.id} className="align-top">
                          <td className="px-3 py-2 font-medium">{check.day}</td>
                          <td className="px-3 py-2 text-xs leading-5">
                            <div>{alertCheckStatusText(check.status)}</div>
                            <AdminTime
                              date={check.completedAt ?? check.startedAt}
                            />
                          </td>
                          {(["email", "discord"] as const).map((channel) => {
                            const counts = check.channels[channel];
                            return (
                              <td key={channel} className="px-3 py-2">
                                {counts === undefined ? (
                                  <span className="text-muted-foreground">
                                    None
                                  </span>
                                ) : (
                                  channelText(counts)
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </WhenLoaded>
      </AdminSection>
    </div>
  );
}
