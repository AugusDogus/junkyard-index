import {
  AdminPageHeader,
  AdminSection,
  formatCount,
  Stat,
  WhenLoaded,
} from "~/components/admin/AdminParts";
import { AdminTime } from "~/components/admin/AdminTime";
import { BarChart, formatAmount, formatDay } from "~/components/admin/BarChart";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { ALGOLIA_FREE_PLAN } from "~/server/admin/algolia-budget";
import { BudgetData } from "~/server/admin/budget-data";
import {
  HYPERBROWSER_BURN_DAYS,
  HYPERBROWSER_FORECAST_DAYS,
  HyperbrowserBudget,
} from "~/server/admin/hyperbrowser-budget";
import { adminMetadata, requireAdmin } from "~/server/admin/require-admin";

export function generateMetadata() {
  return adminMetadata({ title: "Budgets" });
}

const ALGOLIA_DASHBOARD_URL = "https://dashboard.algolia.com/";

function monthEndLabel(now: Date): string {
  const lastDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  );
  return formatDay(lastDay.toISOString().slice(0, 10));
}

export default async function AdminBudgetsPage() {
  await requireAdmin();
  const now = new Date();
  const [hyperbrowser, algoliaRecords] = await Promise.all([
    BudgetData.hyperbrowser(),
    BudgetData.algoliaRecords(),
  ]);

  return (
    <div className="space-y-12">
      <AdminPageHeader
        title="Budgets"
        description="How much of the paid services' free plans the site has used, and when they could run out. Figures from Hyperbrowser and Algolia are up to 10 minutes old. Opening this page uses no Algolia searches."
      />

      <AdminSection
        title="Hyperbrowser credits"
        description="Hyperbrowser runs the remote browsers for the yards that block ordinary requests. The free plan has 5,000 credits. Whether they renew each month is not confirmed, so treat the remaining credits as all there are until Hyperbrowser confirms otherwise."
      >
        <WhenLoaded loaded={hyperbrowser}>
          {(snapshot) => {
            const { credits, daily, coverage } = snapshot;
            const forecast = HyperbrowserBudget.forecast(snapshot, now);
            const monthEnd = monthEndLabel(now);
            const runsOutBeforeMonthEnd =
              forecast.runsOut.kind === "on" && forecast.runsOut.beforeMonthEnd
                ? formatDay(forecast.runsOut.day)
                : null;
            return (
              <div className="space-y-6">
                {runsOutBeforeMonthEnd !== null && (
                  <Alert variant="destructive">
                    <AlertTitle>
                      Credits run out around {runsOutBeforeMonthEnd}
                    </AlertTitle>
                    <AlertDescription>
                      At the recent pace the remaining credits last until about{" "}
                      {runsOutBeforeMonthEnd}, before the month ends. After
                      that, the yards that use Hyperbrowser stop updating.
                    </AlertDescription>
                  </Alert>
                )}
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat
                    label="Used"
                    value={formatAmount(credits.usage)}
                    hint={`of ${formatCount(credits.limit)}`}
                  />
                  <Stat
                    label="Remaining"
                    value={formatAmount(credits.remaining)}
                  />
                  <Stat
                    label="Average per day"
                    value={formatAmount(forecast.averagePerDay)}
                    hint={`Over the last ${HYPERBROWSER_FORECAST_DAYS} full days`}
                  />
                  <Stat
                    label={`Used by ${monthEnd} at that pace`}
                    value={formatAmount(forecast.projectedMonthEndUsage)}
                    hint={
                      forecast.projectedMonthEndUsage > credits.limit
                        ? "More than the plan has"
                        : `of ${formatCount(credits.limit)}`
                    }
                  />
                  <Stat
                    label="Remaining credits last until"
                    value={
                      <span className="text-base">
                        {forecast.runsOut.kind === "never"
                          ? "No recent use"
                          : formatDay(forecast.runsOut.day)}
                      </span>
                    }
                    hint="At the average above"
                  />
                </dl>
                <BarChart
                  title={`Credits used per day, last ${HYPERBROWSER_BURN_DAYS} days`}
                  data={daily}
                />
                <div className="text-muted-foreground space-y-2 text-sm leading-6">
                  <p>
                    Days are UTC. Hyperbrowser sessions do not record which yard
                    opened them, so this is the total for all yards.
                  </p>
                  {coverage.kind === "partial" && (
                    <p>
                      There were too many sessions to read them all, so days
                      before {formatDay(coverage.fromDay)} show less than was
                      used.
                    </p>
                  )}
                  <p>
                    Checked <AdminTime date={new Date(snapshot.fetchedAt)} />.
                  </p>
                </div>
              </div>
            );
          }}
        </WhenLoaded>
      </AdminSection>

      <AdminSection
        title="Algolia"
        description="Algolia runs the vehicle search. The free plan allows 10,000 search requests per billing period (the 21st to the 20th) and 1,000,000 records. Running out of searches stops search for everyone."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <dl>
            <Stat
              label="Search requests this period"
              value={
                <span className="text-base">Not available on this plan</span>
              }
              hint={
                <>
                  Algolia only reports this count to paid Premium plans. See
                  Usage in the{" "}
                  <a
                    href={ALGOLIA_DASHBOARD_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4"
                  >
                    Algolia dashboard
                  </a>
                  . Algolia also emails at 80% and 100% of the{" "}
                  {formatCount(ALGOLIA_FREE_PLAN.searchRequestsPerMonth)}.
                </>
              }
            />
          </dl>
          <WhenLoaded loaded={algoliaRecords}>
            {(records) => (
              <dl>
                {records.kind === "production_only" ? (
                  <Stat
                    label="Records"
                    value={<span className="text-base">Production only</span>}
                    hint="Only the live site holds the Algolia key that can read this."
                  />
                ) : (
                  <Stat
                    label="Records"
                    value={formatCount(records.value)}
                    hint={`of ${formatCount(ALGOLIA_FREE_PLAN.records)}`}
                  />
                )}
              </dl>
            )}
          </WhenLoaded>
        </div>
      </AdminSection>
    </div>
  );
}
