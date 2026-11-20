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
  /** Days on which an accepted run published a page cut by the fault. */
  publishedCut: number[];
  /** Days on which a run was rejected. */
  rejected: number[];
}

/**
 * One simulated Chaz yard: a cold run on D, daily runs to D + 16 with `rate`
 * plus-or-minus-one count events a day (weighted by model size, changing the
 * badge and the true inventory together) and one random arrival trigger a
 * day. With `cut`, slice 5 lists one card per page from D + 11 while its
 * badges hold. Accepted runs advance the census; rejected runs leave it.
 */
function simulate(seed: number, rate: number, cut: boolean): Outcome {
  const next = random(seed);
  const badges = graph.map((m) => m.badge);
  const truth = graph.map((m) => (m.dead ? 0 : m.badge));
  const sliced = graph.map(
    (m) => !m.dead && ModelCensus.slice(m.key) === CUT_SLICE,
  );
  const controls = (): ModelCensusControl[] =>
    graph.map((m, i) => ({ key: m.key, count: badges[i] ?? 0 }));
  const listed = (day: number, i: number) => {
    const real = truth[i] ?? 0;
    return cut && day >= D + 11 && sliced[i] ? Math.min(real, 1) : real;
  };
  let census: ModelCensusState<number> | null = null;
  const outcome: Outcome = { publishedCut: [], rejected: [] };
  for (let day = D; day <= D + 16; day++) {
    if (day > D)
      for (let event = 0; event < rate; event++) {
        // Weight by size so large models change more often.
        const total = badges.reduce((n, b) => n + b + 1, 0);
        let pick = next() * total;
        let i = 0;
        while (i < badges.length - 1 && pick >= (badges[i] ?? 0) + 1) {
          pick -= (badges[i] ?? 0) + 1;
          i++;
        }
        const up = next() < 0.5;
        const badge = badges[i] ?? 0;
        if (!up && badge === 0) continue;
        badges[i] = badge + (up ? 1 : -1);
        if (!graph[i]?.dead)
          truth[i] = Math.max(0, (truth[i] ?? 0) + (up ? 1 : -1));
      }
    const triggers = new Set(
      day > D ? [graph[Math.floor(next() * graph.length)]?.key ?? ""] : [],
    );
    const models = controls();
    const decisions: ModelCensusDecision<number>[] = ModelCensus.plan(
      models,
      census,
      day,
      {
        cards,
        triggers,
      },
    );
    const pages: number[] = decisions.map((d, i) =>
      d.kind === "carry" ? d.evidence.page : listed(day, i),
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
    if (
      pages.some(
        (page, i) =>
          sliced[i] && cut && day >= D + 11 && page < (truth[i] ?? 0),
      )
    )
      outcome.publishedCut.push(day);
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
  for (const rate of [5, 10, 20])
    test(`never publishes a cut sweep slice before the outage path at ${rate} count events a day`, () => {
      const early: string[] = [];
      for (let seed = 1; seed <= 200; seed++) {
        const { publishedCut } = simulate(seed, rate, true);
        // The last accepted run before the fault is D + 10; the outage path
        // (badge floor only) starts once it is six days old, on D + 16.
        const before = publishedCut.filter(
          (day) => day < D + 10 + MODEL_CENSUS_SWEEP_DAYS,
        );
        if (before.length) early.push(`seed ${seed}: ${before.join(", ")}`);
      }
      expect(early).toEqual([]);
    });

  for (const rate of [5, 10, 20])
    test(`accepts every healthy daily run at ${rate} count events a day`, () => {
      const rejected: string[] = [];
      for (let seed = 1; seed <= 200; seed++) {
        const outcome = simulate(seed, rate, false);
        if (outcome.rejected.length)
          rejected.push(`seed ${seed}: ${outcome.rejected.join(", ")}`);
      }
      expect(rejected).toEqual([]);
    });
});
