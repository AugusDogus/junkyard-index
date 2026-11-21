import { describe, expect, test } from "bun:test";
import { CHAZ_MINIMUM_BADGE_COVERAGE } from "./chaz-cursor";
import { chazFixtureNov18Graph } from "./chaz-test-fixtures";
import {
  MODEL_CENSUS_SWEEP_DAYS,
  ModelCensus,
  type ModelCensus as ModelCensusState,
  type ModelCensusControl,
  type ModelCensusDecision,
} from "./model-census";

/** Deterministic 32-bit PRNG (mulberry32) so every seed replays exactly. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The real Nov 18 Chaz graph, keyed exactly as chazCensusControls keys it.
 * Healthy pages list their badge, except the dead `&` routes, which list 0. */
const graph = chazFixtureNov18Graph.flatMap((make) =>
  make.models.map((model) => ({
    key: JSON.stringify([make.path, make.label, model.path, model.label]),
    label: `${make.label} ${model.label}`,
    badge: model.count,
    dead: model.label.includes("&"),
  })),
);
// D is a multiple of six, so slice 5 is due on D + 5 and D + 11.
const D = 6000;
const CUT_SLICE = 5;
const cards = (page: number) => page;

interface Outcome {
  /** Days on which an accepted run read a page cut by the fault and
   * published it before any outage-path run (six or more days after the last
   * accepted census) took the cut as the new truth. */
  publishedCutEarly: number[];
  /** Days on which a run was rejected. */
  rejected: number[];
  /** Accepted runs that followed a missed day (full `gap` reads). */
  acceptedAfterGap: number;
  /** Faulted models a later accepted run carried instead of reading. */
  stuckFaults: string[];
}

interface Pending {
  due: number;
  model: number;
  kind: "badge-down" | "card-up";
}

/**
 * One simulated Chaz yard on the real Nov 18 graph, from a cold run on D to
 * D + 24, with realistic healthy drift:
 * - `rate` events a day, weighted by model size, half arrivals and half sales;
 * - a sale removes its card at once and its badge 0 to 2 days later;
 * - an arrival raises its badge at once and its card 0 to 2 days later;
 * - every 40th model lists one placeholder card above its badge;
 * - one random arrival trigger a day, and with `missed` set, about one day in
 *   ten has no run at all, so the next run is a full `gap` read.
 * With `cut`, slice 5 lists one card per page from D + 11 while its badges
 * hold. Accepted runs advance the census; rejected runs leave it.
 */
function simulate(
  seed: number,
  rate: number,
  options: {
    cut: boolean;
    missed: boolean;
    gapFault?: boolean;
    surplusFault?: boolean;
  },
): Outcome {
  const next = random(seed);
  const badges = graph.map((m) => m.badge);
  const truth = graph.map((m) => (m.dead ? 0 : m.badge));
  // Every 40th model lists placeholder rows above its badge: two on every
  // 80th model, one on the rest.
  const surplus = graph.map((m, i) =>
    m.dead ? 0 : i % 80 === 0 ? 2 : i % 40 === 0 ? 1 : 0,
  );
  const sliced = graph.map(
    (m) => !m.dead && ModelCensus.slice(m.key) === CUT_SLICE,
  );
  const pending: Pending[] = [];
  const controls = (): ModelCensusControl[] =>
    graph.map((m, i) => ({ key: m.key, count: badges[i] ?? 0 }));
  const healthy = (i: number) => (truth[i] ?? 0) + (surplus[i] ?? 0);
  const listed = (day: number, i: number) =>
    options.cut && day >= D + 11 && sliced[i]
      ? Math.min(healthy(i), 1)
      : healthy(i);
  let census: ModelCensusState<number> | null = null;
  // Models faulted on the last accepted run, checked on the next run.
  let stuck = new Set<number>();
  // Last day each placeholder model was faulted (`surplusFault`).
  const lastFault = new Map<number, number>();
  // Set once the outage path accepts the cut as a real drop, by design.
  let outage = false;
  const outcome: Outcome = {
    publishedCutEarly: [],
    rejected: [],
    acceptedAfterGap: 0,
    stuckFaults: [],
  };
  for (let day = D; day <= D + 24; day++) {
    if (day > D) {
      for (let event = 0; event < rate; event++) {
        // Weight by size so large models change more often.
        const total = badges.reduce((n, b) => n + b + 1, 0);
        let pick = next() * total;
        let i = 0;
        while (i < badges.length - 1 && pick >= (badges[i] ?? 0) + 1) {
          pick -= (badges[i] ?? 0) + 1;
          i++;
        }
        const lag = Math.floor(next() * 3);
        if (graph[i]?.dead) continue;
        if (next() < 0.5) {
          badges[i] = (badges[i] ?? 0) + 1;
          pending.push({ due: day + lag, model: i, kind: "card-up" });
        } else if ((truth[i] ?? 0) > 0) {
          truth[i] = (truth[i] ?? 0) - 1;
          pending.push({ due: day + lag, model: i, kind: "badge-down" });
        }
      }
      for (const change of pending.filter((p) => p.due <= day)) {
        if (change.kind === "card-up")
          truth[change.model] = (truth[change.model] ?? 0) + 1;
        else
          badges[change.model] = Math.max(0, (badges[change.model] ?? 0) - 1);
      }
      pending.splice(0, pending.length, ...pending.filter((p) => p.due > day));
    }
    const triggers = new Set(
      day > D ? [graph[Math.floor(next() * graph.length)]?.key ?? ""] : [],
    );
    // A missed run: nothing is read, nothing is accepted.
    if (options.missed && day > D && next() < 0.1) continue;
    const models = controls();
    const decisions: ModelCensusDecision<number>[] = ModelCensus.plan(
      models,
      census,
      day,
      { cards, triggers },
    );
    // With `gapFault`, a fault confined to each gap run lists five models
    // (two of them placeholder models) one card below their true count, small
    // enough to pass both floors; closing repeats it. With `surplusFault`, on
    // any run a placeholder page read that day loses one real card while its
    // placeholder stays, so it lists at least its badge and looks healthy page
    // by page. Either way the next accepted run must read the model again.
    const gapRun = census !== null && day - census.day > 1;
    const faulted = new Set<number>();
    const placeholders = graph.flatMap((m, i) =>
      surplus[i] && healthy(i) >= 3 ? [i] : [],
    );
    if (options.gapFault && gapRun) {
      // Bounded draws: few placeholder models may be eligible on a given day.
      for (let draw = 0; draw < 50 && faulted.size < 2; draw++) {
        const i = placeholders[Math.floor(next() * placeholders.length)];
        if (i !== undefined) faulted.add(i);
      }
      for (let draw = 0; draw < 500 && faulted.size < 5; draw++) {
        const i = Math.floor(next() * graph.length);
        if (!graph[i]?.dead && healthy(i) >= 3) faulted.add(i);
      }
    }
    // A cold run has no history, so a fault that leaves a placeholder page at
    // exactly its badge has no signal there (an accepted cold-start limit);
    // one that still leaves it above its badge must be read again next run.
    // Each fault is confined to one day: a model is faulted again only after
    // a week, since a drop that lasts six run days is accepted as real.
    if (options.surplusFault)
      for (const i of placeholders)
        if (
          decisions[i]?.kind === "read" &&
          healthy(i) - 1 >= (badges[i] ?? 0) + (census === null ? 1 : 0) &&
          day - (lastFault.get(i) ?? -Infinity) > MODEL_CENSUS_SWEEP_DAYS + 1 &&
          next() < 0.5
        ) {
          faulted.add(i);
          lastFault.set(i, day);
        }
    const pages: number[] = decisions.map((d, i) =>
      d.kind === "carry"
        ? d.evidence.page
        : faulted.has(i)
          ? healthy(i) - 1
          : listed(day, i),
    );
    const shortfall = ModelCensus.coverage(
      "Chaz",
      { controls: models, pages, previous: census, day, cards },
      CHAZ_MINIMUM_BADGE_COVERAGE,
      (i) => graph[i]?.label ?? "?",
    );
    if (shortfall) {
      outcome.rejected.push(day);
      continue;
    }
    // The run after a faulted accepted run must read every faulted model.
    for (const i of stuck)
      if (decisions[i]?.kind === "carry")
        outcome.stuckFaults.push(`${graph[i]?.label ?? "?"} on ${day}`);
    const gap = census === null ? 0 : day - census.day;
    if (gap > 1) outcome.acceptedAfterGap++;
    if (options.cut && day >= D + 11) {
      if (gap >= MODEL_CENSUS_SWEEP_DAYS) outage = true;
      else if (
        !outage &&
        decisions.some(
          (d, i) => d.kind === "read" && sliced[i] && healthy(i) > 1,
        )
      )
        outcome.publishedCutEarly.push(day);
    }
    stuck = faulted;
    census = ModelCensus.accept(
      "chaz-property",
      day,
      { controls: models, pages, decisions, previous: census, cards },
      // Chaz closing re-reads every short page read this run identically.
      "confirmed",
    );
  }
  return outcome;
}

describe("Chaz census on the real Nov 18 graph", () => {
  for (const missed of [false, true])
    for (const rate of [5, 10, 20])
      test(`never publishes a cut sweep slice before the outage path at ${rate} events a day${missed ? " with missed days" : ""}`, () => {
        const early: string[] = [];
        for (let seed = 1; seed <= 200; seed++) {
          const { publishedCutEarly } = simulate(seed, rate, {
            cut: true,
            missed,
          });
          if (publishedCutEarly.length)
            early.push(`seed ${seed}: ${publishedCutEarly.join(", ")}`);
        }
        expect(early).toEqual([]);
      });

  for (const rate of [5, 10, 20])
    test(`accepts every healthy run, including full reads after missed days, at ${rate} events a day`, () => {
      const rejected: string[] = [];
      let afterGap = 0;
      for (let seed = 1; seed <= 200; seed++) {
        const outcome = simulate(seed, rate, { cut: false, missed: true });
        afterGap += outcome.acceptedAfterGap;
        if (outcome.rejected.length)
          rejected.push(`seed ${seed}: ${outcome.rejected.join(", ")}`);
      }
      expect(rejected).toEqual([]);
      // The missed days really produced full reads after a gap.
      expect(afterGap).toBeGreaterThan(100);
    });

  for (const rate of [5, 10, 20])
    test(`heals a fault one below the true count on a gap run at ${rate} events a day`, () => {
      const stuck: string[] = [];
      let gapRuns = 0;
      for (let seed = 1; seed <= 200; seed++) {
        const outcome = simulate(seed, rate, {
          cut: false,
          missed: true,
          gapFault: true,
        });
        gapRuns += outcome.acceptedAfterGap;
        if (outcome.stuckFaults.length)
          stuck.push(`seed ${seed}: ${outcome.stuckFaults.join(", ")}`);
      }
      expect(stuck).toEqual([]);
      expect(gapRuns).toBeGreaterThan(100);
    });

  for (const rate of [5, 10, 20])
    test(`heals a real card lost behind a placeholder on any run at ${rate} events a day`, () => {
      const stuck: string[] = [];
      for (let seed = 1; seed <= 200; seed++) {
        const outcome = simulate(seed, rate, {
          cut: false,
          missed: true,
          surplusFault: true,
        });
        if (outcome.stuckFaults.length)
          stuck.push(`seed ${seed}: ${outcome.stuckFaults.join(", ")}`);
      }
      expect(stuck).toEqual([]);
    });
});
