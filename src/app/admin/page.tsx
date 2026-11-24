import Link from "next/link";
import {
  AdminPageHeader,
  AdminSection,
  LoadFailure,
  RawText,
  Stat,
  WhenLoaded,
} from "~/components/admin/AdminParts";
import { AdminLinkPending } from "~/components/admin/AdminLinkPending";
import { AdminTime } from "~/components/admin/AdminTime";
import { StopRunControl } from "~/components/admin/StopRunControl";
import {
  alertCheckStatusText,
  SearchBacklogText,
} from "~/components/admin/SearchParts";
import { AdminData } from "~/server/admin/admin-data";
import { Attention } from "~/server/admin/attention";
import { adminMetadata, requireAdmin } from "~/server/admin/require-admin";
import { RunHold } from "~/server/admin/run-hold";
import { SourceOverview } from "~/server/admin/source-overview";

// The layout's "%s | Admin" template applies to child segments only.
export function generateMetadata() {
  return adminMetadata({ title: "Admin" });
}

export default async function AdminOverviewPage() {
  await requireAdmin();
  const now = new Date();
  const [sources, holds, search, alerts] = await Promise.all([
    AdminData.sources(now),
    AdminData.holds(now),
    AdminData.search(now),
    AdminData.alerts(now),
  ]);
  // A run holding up others comes first: it blocks every source behind it.
  const runAttention =
    holds.status === "ok" ? RunHold.attention(holds.value) : [];
  const attention = Attention.collect({
    now,
    sources: sources.status === "ok" ? sources.value.summaries : [],
    latestErrors:
      sources.status === "ok" ? sources.value.latestErrors : new Map(),
    searchProblems:
      search.status === "ok" ? search.value.overview.problems : [],
    alertProblems:
      alerts.status === "ok" && alerts.value.status.status === "unhealthy"
        ? alerts.value.status.problems
        : [],
    listedRunIds: new Set(
      runAttention.flatMap((item) => item.runs.map((run) => run.runId)),
    ),
  });

  return (
    <div className="space-y-12">
      <AdminPageHeader
        title="Overview"
        description="How the yard feeds, search and saved-search alerts are doing right now."
      />

      <AdminSection title="Needs attention">
        {holds.status === "failed" && (
          <div className="mb-3">
            <LoadFailure failure={holds} />
          </div>
        )}
        {attention.length === 0 && runAttention.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing needs attention right now.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {runAttention.map((item) => (
              <li key={`${item.href}:${item.title}`} className="p-4 text-sm">
                <Link
                  href={item.href}
                  className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
                >
                  {item.title}
                  <AdminLinkPending />
                </Link>
                <p className="text-muted-foreground mt-1">{item.detail}</p>
                <ul className="mt-3 grid gap-3">
                  {item.runs.map((run) => (
                    <li key={run.runId} className="grid gap-1">
                      {item.runs.length > 1 && (
                        <span>
                          {run.name}: run {run.runId}, at the {run.stage} stage
                        </span>
                      )}
                      <StopRunControl run={run} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {attention.map((item) => (
              <li key={`${item.href}:${item.title}`} className="p-4 text-sm">
                <Link
                  href={item.href}
                  className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
                >
                  {item.title}
                  <AdminLinkPending />
                </Link>
                <div className="text-muted-foreground mt-1">
                  <RawText summary={item.detail} raw={item.raw} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      <AdminSection
        title="Sources"
        description="Each yard feed by its state. Retired feeds are no longer fetched; hidden ones still update but stay off the public site."
      >
        <WhenLoaded loaded={sources}>
          {(data) => {
            const counts = SourceOverview.counts(data.summaries);
            return (
              <div className="space-y-4">
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat
                    label="Updated today"
                    value={counts.byState.accepted_today}
                  />
                  <Stat label="Failing" value={counts.byState.failing} />
                  <Stat label="Out of date" value={counts.byState.stale} />
                  <Stat label="Running" value={counts.byState.running} />
                  <Stat label="Paused" value={counts.byState.paused} />
                  <Stat label="Hidden" value={counts.hidden} />
                  <Stat label="Retired" value={counts.byState.retired} />
                </dl>
                <p className="text-sm">
                  Latest run started:{" "}
                  <AdminTime
                    date={data.lastRunStartedAt}
                    empty="None in 14 days"
                  />
                  .{" "}
                  {counts.byState.waiting > 0 &&
                    `${counts.byState.waiting} more have not updated yet today. `}
                  <Link
                    href="/admin/sources"
                    className="inline-flex items-center gap-1.5 underline underline-offset-4"
                  >
                    See every source
                    <AdminLinkPending />
                  </Link>
                </p>
                {data.flags.status === "unavailable" && (
                  <RawText
                    summary="The Vercel pause flags could not be read, so only sources paused here show as paused. The others run as if their flag were on."
                    raw={data.flags.message}
                    label="Show details"
                  />
                )}
              </div>
            );
          }}
        </WhenLoaded>
      </AdminSection>

      <AdminSection title="Search">
        <WhenLoaded loaded={search}>
          {({ overview }) => (
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat
                label="Last search update"
                value={
                  <span className="text-base">
                    <AdminTime date={overview.newestSearchPublishedAt} />
                  </span>
                }
              />
              <Stat
                label="Changes waiting for search"
                value={<SearchBacklogText backlog={overview.backlog} />}
              />
              <Stat
                label="Full rebuild needed"
                value={overview.fullReindexRequired ? "Yes" : "No"}
              />
            </dl>
          )}
        </WhenLoaded>
      </AdminSection>

      <AdminSection title="Saved-search alerts">
        <WhenLoaded loaded={alerts}>
          {({ mode, checks }) => {
            const latest = checks[0];
            return (
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Stat
                  label="Alerts"
                  value={mode === "enabled" ? "On" : "Paused"}
                />
                <Stat
                  label="Last alert check"
                  value={
                    <span className="text-base">
                      {latest === undefined ? (
                        "None in 14 days"
                      ) : (
                        <>
                          {latest.day}, {alertCheckStatusText(latest.status)}
                        </>
                      )}
                    </span>
                  }
                  hint={
                    latest === undefined ? undefined : (
                      <AdminTime
                        date={latest.completedAt}
                        empty="Not finished yet"
                      />
                    )
                  }
                />
              </dl>
            );
          }}
        </WhenLoaded>
      </AdminSection>
    </div>
  );
}
