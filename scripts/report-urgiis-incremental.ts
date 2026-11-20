import {
  urgiisCoverageProbe,
  urgiisEquinoxProbe,
} from "../src/server/ingestion/urgiis-route-probe";
import {
  urgiisBrokenModelRoute,
  urgiisModelCoverage,
} from "../src/server/ingestion/urgiis-model-coverage";
import { urgiisSnapshot } from "../src/server/ingestion/urgiis-snapshot";
import { urgiisArrivalDate } from "../src/server/ingestion/urgiis-arrivals";
import { URGIIS_TENANTS } from "../src/server/ingestion/urgiis-configuration";
import { UrgiisReplayArchive } from "../src/server/ingestion/urgiis-replay-archive";
import {
  iisCards,
  iisDirectory,
  iisValidateModelPage,
} from "../src/server/ingestion/urgiis-catalog";
import { urgiisDetailSeller } from "../src/server/ingestion/urgiis-detail";
import {
  urgiisFingerprint,
  urgiisTasks,
  type UrgiisEntry,
  type UrgiisTask,
} from "../src/server/ingestion/urgiis-traversal";
import {
  URGIIS_DAY_MS,
  UrgiisCensus,
  urgiisCarry,
} from "../src/server/ingestion/urgiis-census";

// Offline request accounting. The latency scenario is explicit, not a live timing
// claim: 6 seconds per HTML response plus each tenant's configured response gate.
const rows = [];
const outcomes = [];
const blocked: {
  tenant: string;
  models: { path: string; reason: string }[];
}[] = [];
const start = Date.UTC(2026, 10, 16);
for (const tenant of URGIIS_TENANTS) {
  const archive = await UrgiisReplayArchive.open(tenant.code);
  const entries: UrgiisEntry[] = [];
  const incompleteModels: { path: string; reason: string }[] = [];
  let detailTasks: UrgiisTask[] | null = null;
  try {
    while (true) {
      const tasks: UrgiisTask[] = detailTasks ?? urgiisTasks(entries, tenant);
      const task = tasks[entries.length];
      if (!task) break;
      if (task.kind === "detail") detailTasks = tasks;
      const response = await archive.next();
      if (!response || response.url !== task.url)
        throw new Error(`Fixture frontier changed for ${tenant.code}`);
      const receipt = { url: task.url, bytes: 1 };
      if (task.kind === "owner")
        entries.push({
          ...receipt,
          kind: "owner",
          identity: urgiisFingerprint(tenant.ownerClaims),
        });
      else if (task.kind === "menu" || task.kind === "makes")
        entries.push({
          ...receipt,
          kind: task.kind,
          controls: iisDirectory(
            response.html,
            tenant,
            task.kind === "menu" ? task.make : undefined,
          ),
        });
      else if (task.kind === "detail")
        entries.push({
          ...receipt,
          kind: "detail",
          seller: urgiisDetailSeller(response.html, tenant, task),
          readAt: start,
        });
      else {
        const html =
          task.kind === "model" && tenant.code !== "eagle"
            ? (urgiisCoverageProbe(tenant, task.url)?.html ?? response.html)
            : response.html;
        const page = iisCards(html, tenant, task.kind);
        if (task.kind === "model") {
          try {
            iisValidateModelPage(page, task.model);
          } catch (cause) {
            incompleteModels.push({
              path: task.model.path,
              reason: cause instanceof Error ? cause.message : String(cause),
            });
          }
        }
        const records = page.records;
        entries.push(
          task.kind === "model"
            ? {
                ...receipt,
                kind: "model",
                records,
                freshness: { kind: "read", readAt: start },
              }
            : { ...receipt, kind: "arrivals", records },
        );
      }
    }
    const coverage = urgiisModelCoverage(entries);
    const ordinary = incompleteModels.filter(
      (m) => !urgiisBrokenModelRoute({ path: m.path, label: "", count: 2 }),
    );
    let retryRequests = 0;
    for (const model of ordinary) {
      const url = tenant.origin + model.path;
      const probe =
        urgiisCoverageProbe(tenant, url) ??
        (tenant.code === "revolution" && url === urgiisEquinoxProbe().url
          ? urgiisEquinoxProbe()
          : undefined);
      if (probe) {
        const entry = entries.find((e) => e.kind === "model" && e.url === url);
        if (entry?.kind !== "model")
          throw new Error("Missing retried model entry");
        entry.records = iisCards(probe.html, tenant).records;
        retryRequests++;
      }
    }
    const unrecovered = ordinary.filter((m) =>
      entries.some(
        (e) =>
          e.kind === "model" &&
          e.url === tenant.origin + m.path &&
          e.records.length === 0,
      ),
    );
    const pages = urgiisTasks(entries, tenant).flatMap((task, i) => {
      const entry = entries[i];
      return task.kind === "model" && entry?.kind === "model"
        ? [
            {
              make: task.make,
              model: task.model,
              records: entry.records,
              hash: "",
            },
          ]
        : [];
    });
    const snapshot = urgiisSnapshot(
      pages,
      tenant,
      new Map(
        entries.flatMap((e) =>
          e.kind === "detail" ? [[e.url, e.seller] as const] : [],
        ),
      ),
      entries.flatMap((e) => (e.kind === "arrivals" ? e.records : [])),
    );
    const reasons = [
      ...unrecovered.map(
        (m) =>
          m.reason + "; no saved successful retry or prior accepted census",
      ),
      ...(coverage.blocked ? [coverage.message] : []),
    ];
    outcomes.push({
      tenant: tenant.code,
      status: reasons.length ? "blocked" : "published",
      accepted: reasons.length ? 0 : snapshot.vehicles.length,
      candidates: snapshot.vehicles.length,
      advertised: coverage.advertised,
      unreachable: coverage.count,
      unreachableModels: coverage.unreachable,
      warnings: coverage.count && !coverage.blocked ? [coverage.message] : [],
      reasons,
      retryRequests,
    });
    if (reasons.length) {
      blocked.push({
        tenant: tenant.code,
        models: incompleteModels.filter(
          (m) => unrecovered.includes(m) || coverage.blocked,
        ),
      });
      continue;
    }
    const census = UrgiisCensus.accept(
      UrgiisCensus.empty(),
      tenant,
      entries,
      start,
    ).tenants[0];
    let previous = census;
    const tasks = urgiisTasks(entries, tenant);
    const closingRequests = tasks.filter(
      (t) => t.kind === "owner" || t.kind === "makes" || t.kind === "menu",
    ).length;
    const requests: number[] = [];
    for (let day = 1; day <= 7; day++) {
      const today: UrgiisEntry[] = [];
      let count = closingRequests;
      tasks.forEach((task, index) => {
        const original = entries[index];
        if (!original) throw new Error("Missing fixture entry");
        const carry = urgiisCarry(
          task,
          today,
          previous,
          start + day * URGIIS_DAY_MS,
        );
        today.push(
          carry ??
            (original.kind === "model"
              ? {
                  ...original,
                  freshness: {
                    kind: "read",
                    readAt: start + day * URGIIS_DAY_MS,
                  },
                }
              : original.kind === "detail"
                ? { ...original, readAt: start + day * URGIIS_DAY_MS }
                : original),
        );
        if (!carry) count++;
      });
      requests.push(count);
      previous = UrgiisCensus.accept(
        UrgiisCensus.empty(),
        tenant,
        today,
        start + day * URGIIS_DAY_MS,
      ).tenants[0];
    }
    const average = requests.reduce((a, b) => a + b, 0) / 7;
    const modelStocks = new Set(
      entries.flatMap((e) =>
        e.kind === "model"
          ? e.records.flatMap((r) => (r.stock ? [r.stock] : []))
          : [],
      ),
    );
    const arrivals = entries.flatMap((e) =>
      e.kind === "arrivals" ? e.records : [],
    );
    const arrivalStocks = new Set(
      arrivals.flatMap((r) => (r.stock ? [r.stock] : [])),
    );
    const overlap = [...arrivalStocks].filter((stock) =>
      modelStocks.has(stock),
    ).length;
    const arrivalDates = arrivals.map(urgiisArrivalDate);
    let comparableDatePairs = 0;
    let outOfOrderDatePairs = 0;
    let comparablePurchasePairs = 0;
    let outOfOrderPurchasePairs = 0;
    for (let index = 1; index < arrivals.length; index++) {
      const before = arrivalDates[index - 1];
      const current = arrivalDates[index];
      if (
        before === null ||
        before === undefined ||
        current === null ||
        current === undefined
      )
        continue;
      comparableDatePairs++;
      if (current > before) outOfOrderDatePairs++;
      if (arrivals[index - 1]?.purchaseDate && arrivals[index]?.purchaseDate) {
        comparablePurchasePairs++;
        if (current > before) outOfOrderPurchasePairs++;
      }
    }
    const seconds = tenant.pacingMs / 1000 + 6;
    rows.push({
      tenant: tenant.code,
      makes: closingRequests - 2,
      models: entries.filter((e) => e.kind === "model").length,
      fullRequests: archive.responseCount + retryRequests,
      unchangedNoSweep: closingRequests * 2 + (tenant.arrivalsPath ? 1 : 0),
      weeklyRequests: requests,
      dailyAverage: +average.toFixed(1),
      beforeMinutes: +(
        ((archive.responseCount + retryRequests) * seconds) /
        60
      ).toFixed(1),
      afterMinutes: +((average * seconds) / 60).toFixed(1),
      modelStocks: modelStocks.size,
      arrivalStocks: arrivalStocks.size,
      purchaseDatedArrivals: arrivals.filter(
        (r) => r.purchaseDate !== undefined && r.purchaseDate !== null,
      ).length,
      datedArrivals: arrivalDates.filter((date) => date !== null).length,
      comparableDatePairs,
      outOfOrderDatePairs,
      comparablePurchasePairs,
      outOfOrderPurchasePairs,
      arrivalModelOverlap: overlap,
      arrivalsOnly: arrivalStocks.size - overlap,
      censusBytes: new TextEncoder().encode(JSON.stringify(census)).length,
    });
  } finally {
    archive.close();
  }
}
console.log(
  JSON.stringify(
    {
      latencySeconds: 6,
      blocked,
      outcomes,
      rows,
      totals: {
        publishedTenants: outcomes.filter((o) => o.status === "published")
          .length,
        blockedTenants: outcomes.filter((o) => o.status === "blocked").length,
        accepted: outcomes.reduce((n, o) => n + o.accepted, 0),
        unreachableAdvertised: outcomes.reduce((n, o) => n + o.unreachable, 0),
        beforeRequests: rows.reduce((n, r) => n + r.fullRequests, 0),
        afterRequests: +rows.reduce((n, r) => n + r.dailyAverage, 0).toFixed(1),
        beforeMinutes: +rows
          .reduce((n, r) => n + r.beforeMinutes, 0)
          .toFixed(1),
        afterMinutes: +rows.reduce((n, r) => n + r.afterMinutes, 0).toFixed(1),
        censusBytes: rows.reduce((n, r) => n + r.censusBytes, 0),
      },
    },
    null,
    2,
  ),
);
