import {
  AdminPageHeader,
  AdminSection,
  formatCount,
  Stat,
  WhenLoaded,
} from "~/components/admin/AdminParts";
import { AdminTime } from "~/components/admin/AdminTime";
import { BarChart, formatDay } from "~/components/admin/BarChart";
import {
  ALGOLIA_ANALYTICS_DAYS,
  ALGOLIA_TOP_SEARCHES,
} from "~/server/admin/algolia-budget";
import { AnalyticsData } from "~/server/admin/analytics-data";
import {
  PAID_CHANGE_DAYS,
  type PaidChange,
  type PaidPlan,
} from "~/server/admin/paid-accounts";
import { adminMetadata, requireAdmin } from "~/server/admin/require-admin";
import {
  ANALYTICS_DAYS,
  SAVED_SEARCH_WEEKS,
} from "~/server/admin/site-analytics";

export function generateMetadata() {
  return adminMetadata({ title: "Analytics" });
}

const PLAN_LABELS: Record<PaidPlan, string> = {
  lite_monthly: "Lite, monthly",
  lite_annual: "Lite, yearly",
  full_monthly: "Full, monthly",
  full_annual: "Full, yearly",
  legacy: "Full (older Email Notifications plan)",
};

const PLANS = [
  "full_monthly",
  "full_annual",
  "lite_monthly",
  "lite_annual",
  "legacy",
] as const satisfies readonly PaidPlan[];

const CHANGE_LABELS: Record<PaidChange["kind"], string> = {
  started: "Started",
  cancelled: "Cancelled",
  ended: "Ended",
};

const count = (value: number) => formatCount(value);
const weekOf = (day: string) => `Week of ${formatDay(day)}`;

function percent(part: number, whole: number): string | undefined {
  return whole === 0
    ? undefined
    : `${Math.round((part / whole) * 100)}% of users`;
}

export default async function AdminAnalyticsPage() {
  await requireAdmin();
  const now = new Date();
  const [users, paid, savedSearches, alerts, topSearches] = await Promise.all([
    AnalyticsData.users(now),
    AnalyticsData.paidAccounts(),
    AnalyticsData.savedSearches(now),
    AnalyticsData.alerts(now),
    AnalyticsData.topSearches(),
  ]);

  return (
    <div className="space-y-12">
      <AdminPageHeader
        title="Analytics"
        description="Who signs up, who pays, and how saved searches and alerts are used. Days are UTC. Opening this page uses no Algolia searches."
      />

      <AdminSection title="Users">
        <WhenLoaded loaded={users}>
          {(stats) => (
            <div className="space-y-6">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label="Users" value={count(stats.total)} />
                <Stat
                  label="Verified emails"
                  value={count(stats.verified)}
                  hint={percent(stats.verified, stats.total)}
                />
                <Stat
                  label={`New in ${ANALYTICS_DAYS} days`}
                  value={count(
                    stats.newPerDay.reduce((sum, day) => sum + day.value, 0),
                  )}
                />
              </dl>
              <BarChart
                title="New users per day"
                data={stats.newPerDay}
                valueLabel={count}
              />
            </div>
          )}
        </WhenLoaded>
      </AdminSection>

      <AdminSection
        title="Paid plans"
        description="From Polar, which handles payments. Up to 10 minutes old."
      >
        <WhenLoaded loaded={paid}>
          {(snapshot) => (
            <div className="space-y-6">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat
                  label="Paying accounts"
                  value={count(snapshot.accounts)}
                  hint={
                    snapshot.complete
                      ? undefined
                      : "At least this many; there were too many to count"
                  }
                />
                <Stat
                  label="Set to cancel"
                  value={count(snapshot.cancellingAtPeriodEnd)}
                  hint="Paid until their period ends"
                />
              </dl>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 text-muted-foreground text-xs">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Plan
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-right font-medium"
                      >
                        Active
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {PLANS.map((plan) => (
                      <tr key={plan}>
                        <td className="px-3 py-2">{PLAN_LABELS[plan]}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {count(snapshot.byPlan[plan])}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h3 className="text-sm font-medium">
                  Changes in the last {PAID_CHANGE_DAYS} days
                </h3>
                {snapshot.changes.length === 0 ? (
                  <p className="text-muted-foreground mt-2 text-sm">
                    No plans started, were cancelled or ended.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y rounded-lg border">
                    {snapshot.changes.map((change, index) => (
                      <li
                        key={`${change.at}:${change.kind}:${index}`}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm"
                      >
                        <span>
                          <span className="font-medium">
                            {CHANGE_LABELS[change.kind]}
                          </span>
                          : {PLAN_LABELS[change.plan]}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          <AdminTime date={new Date(change.at)} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-muted-foreground mt-2 text-xs">
                  A plan that ended here but was cancelled earlier may be
                  missing.
                </p>
              </div>
              <p className="text-muted-foreground text-sm">
                Checked <AdminTime date={new Date(snapshot.fetchedAt)} />.
              </p>
            </div>
          )}
        </WhenLoaded>
      </AdminSection>

      <AdminSection title="Saved searches">
        <WhenLoaded loaded={savedSearches}>
          {(stats) => (
            <div className="space-y-6">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Saved searches" value={count(stats.total)} />
                <Stat label="With alerts on" value={count(stats.anyAlerts)} />
                <Stat label="Email alerts" value={count(stats.emailAlerts)} />
                <Stat
                  label="Discord alerts"
                  value={count(stats.discordAlerts)}
                />
              </dl>
              <BarChart
                title={`New saved searches per week, last ${SAVED_SEARCH_WEEKS} weeks`}
                data={stats.perWeek}
                pointLabel={weekOf}
                pointHeading="Week"
                valueLabel={count}
              />
            </div>
          )}
        </WhenLoaded>
      </AdminSection>

      <AdminSection
        title="Alerts sent"
        description="Emails and Discord messages sent per day. One email can cover several of a user's saved searches; Discord sends one message per saved search. The other counts are per saved search: a failed send is retried later, and a cancelled one was dropped before sending, for example because the search changed or alerts were turned off."
      >
        <WhenLoaded loaded={alerts}>
          {(stats) => (
            <div className="space-y-6">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  label="Email failed, retrying"
                  value={count(stats.retrying.email)}
                />
                <Stat
                  label="Discord failed, retrying"
                  value={count(stats.retrying.discord)}
                />
                <Stat
                  label={`Email cancelled, ${ANALYTICS_DAYS} days`}
                  value={count(stats.cancelled.email)}
                />
                <Stat
                  label={`Discord cancelled, ${ANALYTICS_DAYS} days`}
                  value={count(stats.cancelled.discord)}
                />
              </dl>
              <div className="grid gap-8 lg:grid-cols-2">
                <BarChart
                  title="Emails sent per day"
                  data={stats.sent.email}
                  valueLabel={count}
                />
                <BarChart
                  title="Discord messages sent per day"
                  data={stats.sent.discord}
                  valueLabel={count}
                />
              </div>
            </div>
          )}
        </WhenLoaded>
      </AdminSection>

      <AdminSection
        title="Top searches"
        description={`What people searched for most in the last ${ALGOLIA_ANALYTICS_DAYS} days, every sort order together. From Algolia Analytics, which keeps ${ALGOLIA_ANALYTICS_DAYS} days on the free plan; reading it uses no searches. Up to 10 minutes old.`}
      >
        <WhenLoaded loaded={topSearches}>
          {(reading) =>
            reading.kind === "production_only" ? (
              <p className="text-muted-foreground text-sm">
                Shown on the live site only: only it holds the Algolia key that
                can read Analytics.
              </p>
            ) : reading.value.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No searches recorded in the last {ALGOLIA_ANALYTICS_DAYS} days.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 text-muted-foreground text-xs">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Search
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-right font-medium"
                      >
                        Times
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {reading.value.map((search) => (
                      <tr key={search.query}>
                        <td className="px-3 py-2 break-words">
                          {search.query === "" ? (
                            <span className="text-muted-foreground">
                              (no words: browsing with filters only)
                            </span>
                          ) : (
                            search.query
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {count(search.count)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </WhenLoaded>
        <p className="text-muted-foreground mt-3 text-xs">
          Top {ALGOLIA_TOP_SEARCHES}. Algolia counts a search once its typing
          settles, so these are fewer than the search requests billed.
        </p>
      </AdminSection>
    </div>
  );
}
