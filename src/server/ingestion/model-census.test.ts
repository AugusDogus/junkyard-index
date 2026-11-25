import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  MODEL_CENSUS_SWEEP_DAYS,
  ModelCensus,
  type ModelCensus as ModelCensusState,
  type ModelCensusControl,
  type ModelCensusDecision,
  type ModelCensusReuse,
} from "./model-census";

const contract = "fixture-contract";
const controls = (n: number, count = 3): ModelCensusControl[] =>
  Array.from({ length: n }, (_, i) => ({ key: "model-" + i, count }));
/** A fixture page names its model, read day, listed card count and, when a
 * test needs other cards at the same count, a tag for which cards it lists. */
const page = (key: string, day: number, listed: number, tag?: string) =>
  `${key}@${day}#${listed}${tag === undefined ? "" : "/" + tag}`;
const cards = (value: string) =>
  Number((value.split("#")[1] ?? "").split("/")[0]);
/** The cards a fixture page lists: its count and tag, not its read day. */
const identity = (value: string) => value.split("#")[1] ?? "";
const reads = (decisions: readonly ModelCensusDecision<string>[]) =>
  decisions.flatMap((d, i) => (d.kind === "read" ? [i] : []));

/** Runs one census day: reads produce fresh pages, carries reuse evidence. */
function run(
  models: readonly ModelCensusControl[],
  previous: ModelCensusState<string> | null,
  day: number,
  triggers?: ReadonlySet<string>,
  options: {
    /** Cards a read page lists today, by key; otherwise its full count. */
    listed?: ReadonlyMap<string, number>;
    /** Which cards a read page lists, by key, when not the usual ones. */
    tags?: ReadonlyMap<string, string>;
    shortPages?: "confirmed" | "unconfirmed";
    reuse?: ModelCensusReuse;
  } = {},
) {
  const decisions = ModelCensus.plan(models, previous, day, {
    cards,
    triggers,
    reuse: options.reuse ?? "unchanged-key",
  });
  const pages = decisions.map((d, i) => {
    if (d.kind === "carry") return d.evidence.page;
    const model = models[i];
    if (!model) throw new Error("fixture decision has no model");
    return page(
      model.key,
      day,
      options.listed?.get(model.key) ?? model.count,
      options.tags?.get(model.key),
    );
  });
  return {
    decisions,
    pages,
    census: ModelCensus.accept(
      contract,
      day,
      { controls: models, pages, decisions, previous, cards },
      options.shortPages === "unconfirmed"
        ? { kind: "unconfirmed", identity }
        : "confirmed",
    ),
  };
}

describe("ModelCensus", () => {
  test("cold start reads every model", () => {
    const { decisions } = run(controls(10), null, 100);
    expect(
      decisions.every((d) => d.kind === "read" && d.reason === "cold"),
    ).toBe(true);
  });

  test("a previous census dated after this run is treated as cold", () => {
    const { census } = run(controls(4), null, 100);
    expect(ModelCensus.previous(census, contract, 99).kind).toBe("cold");
    expect(run(controls(4), census, 99).decisions.map((d) => d.kind)).toEqual([
      "read",
      "read",
      "read",
      "read",
    ]);
  });

  test("a changed contract or missing census starts cold", () => {
    const { census } = run(controls(4), null, 100);
    expect(ModelCensus.previous(census, "other", 101)).toMatchObject({
      kind: "cold",
      warning: expect.stringContaining("contract"),
    });
    expect(ModelCensus.previous(undefined, contract, 101)).toEqual({
      kind: "cold",
      warning: null,
    });
    expect(ModelCensus.previous(census, contract, 101).kind).toBe(
      "incremental",
    );
  });

  test("unread models carry their evidence and original read day forward", () => {
    const models = controls(12);
    const cold = run(models, null, 100);
    const next = run(models, cold.census, 101);
    const carried = next.decisions.flatMap((d) =>
      d.kind === "carry" ? [d.evidence] : [],
    );
    const due = models.filter(
      (m) => ModelCensus.slice(m.key) === 101 % MODEL_CENSUS_SWEEP_DAYS,
    );
    expect(carried).toHaveLength(models.length - due.length);
    for (const evidence of carried) {
      expect(evidence.page).toBe(page(evidence.key, 100, 3));
      expect(evidence.readDay).toBe(100);
    }
    const accepted = new Map(next.census.models.map((m) => [m.key, m]));
    for (const index of reads(next.decisions))
      expect(accepted.get("model-" + index)?.readDay).toBe(101);
    expect(accepted.get(carried[0]?.key ?? "")?.readDay).toBe(100);
  });

  test("the sweep reads each model exactly once over six unchanged days", () => {
    const models = controls(240);
    let census = run(models, null, 100).census;
    const seen = new Map<number, number>();
    for (let day = 101; day <= 100 + MODEL_CENSUS_SWEEP_DAYS; day++) {
      const next = run(models, census, day);
      const today = reads(next.decisions);
      // About a sixth of the models each day (40 of 240), by stable key slice.
      expect(today.length).toBeGreaterThanOrEqual(25);
      expect(today.length).toBeLessThanOrEqual(55);
      for (const index of today)
        expect(ModelCensus.slice(models[index]?.key ?? "")).toBe(
          day % MODEL_CENSUS_SWEEP_DAYS,
        );
      for (const index of today) seen.set(index, (seen.get(index) ?? 0) + 1);
      census = next.census;
    }
    expect([...seen.keys()].sort((a, b) => a - b)).toEqual(
      models.map((_, i) => i),
    );
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
  });

  test("a changed published count or a trigger forces a read", () => {
    const models = controls(12);
    const cold = run(models, null, 100);
    const changed = models.map((m, i) => (i === 3 ? { ...m, count: 4 } : m));
    const next = run(changed, cold.census, 101, new Set(["model-7"]));
    expect(next.decisions[3]).toEqual({ kind: "read", reason: "count" });
    expect(next.decisions[7]).toEqual({ kind: "read", reason: "trigger" });
    // A new published model is read, a vanished one is dropped.
    const grown = [...models.slice(1), { key: "model-new", count: 1 }];
    const after = run(grown, cold.census, 101);
    expect(after.decisions.at(-1)).toEqual({ kind: "read", reason: "new" });
    expect(after.census.models.map((m) => m.key)).not.toContain("model-0");
  });

  test("missed days never let evidence exceed the six-day ceiling", () => {
    const models = controls(30);
    const cold = run(models, null, 100);
    // No accepted run for five days, then reordered models shift every slice.
    const shifted = [{ key: "model-new", count: 1 }, ...models];
    let census = run(shifted, cold.census, 105).census;
    for (let day = 106; day <= 130; day++) {
      const next = run(shifted, census, day);
      for (const decision of next.decisions)
        if (decision.kind === "carry")
          expect(day - decision.evidence.readDay).toBeLessThan(
            MODEL_CENSUS_SWEEP_DAYS,
          );
      census = next.census;
    }
    // Any gap of more than one day reads every model again.
    const late = run(models, cold.census, 106);
    expect(
      late.decisions.every((d) => d.kind === "read" && d.reason === "gap"),
    ).toBe(true);
  });

  test("a published model appearing or vanishing moves no other model's slice", () => {
    const models = controls(60);
    let census = run(models, null, 100).census;
    for (let day = 101; day <= 105; day++)
      census = run(models, census, day).census;
    // Insert a model at the front and remove one from the middle on day 106.
    const changed = [
      { key: "model-new", count: 1 },
      ...models.slice(0, 30),
      ...models.slice(31),
    ];
    const readsByKey = new Map<string, number>();
    for (let day = 106; day <= 111; day++) {
      const next = run(changed, census, day);
      next.decisions.forEach((d, i) => {
        const key = changed[i]?.key ?? "";
        if (d.kind === "read" && key !== "model-new")
          readsByKey.set(key, (readsByKey.get(key) ?? 0) + 1);
      });
      census = next.census;
    }
    // Every surviving model is read exactly once in six days, never twice.
    expect(readsByKey.size).toBe(59);
    expect([...readsByKey.values()].every((n) => n === 1)).toBe(true);
  });

  test("connector-shaped keys spread over every slice", () => {
    // Real keys repeat the model label in its path, which must not pin the
    // slice parity: each of the six days needs about a sixth of the models.
    const keys = ["ACURA", "HONDA", "TOYOTA", "FORD"].flatMap((make) =>
      Array.from({ length: 150 }, (_, i) =>
        JSON.stringify([
          `/parts/${make}`,
          make,
          `/parts/${make}/M${i}/`,
          `M${i}`,
        ]),
      ),
    );
    const counts = Array.from({ length: MODEL_CENSUS_SWEEP_DAYS }, () => 0);
    for (const key of keys) {
      const day = ModelCensus.slice(key);
      counts[day] = (counts[day] ?? 0) + 1;
    }
    for (const n of counts) {
      expect(n).toBeGreaterThan(keys.length / 6 - 30);
      expect(n).toBeLessThan(keys.length / 6 + 30);
    }
  });

  test("an unconfirmed short page is read again on the next run, never carried", () => {
    const models = controls(12, 10);
    const short = new Map([["model-2", 3]]);
    const cold = run(models, null, 100, undefined, {
      listed: short,
      shortPages: "unconfirmed",
    });
    expect(cold.census.models[2]?.confirmed).toBe(false);
    const next = run(models, cold.census, 101);
    expect(next.decisions[2]).toEqual({ kind: "read", reason: "short" });
    // The full re-read is carried normally from then on.
    expect(next.census.models[2]?.confirmed).toBe(false);
    const after = run(models, next.census, 102);
    expect(after.decisions[2]?.kind).toBe(
      ModelCensus.slice("model-2") === 102 % MODEL_CENSUS_SWEEP_DAYS
        ? "read"
        : "carry",
    );
  });

  test("a cold run confirms nothing; a short page confirmed by an incremental run carries", () => {
    const models = controls(12, 10);
    const listed = new Map([["model-2", 3]]);
    // A cold run is judged on the badge floor alone, so even an identical
    // closing re-read does not confirm its short page.
    const cold = run(models, null, 100, undefined, {
      listed,
      shortPages: "confirmed",
    });
    expect(cold.census.models.some((m) => m.confirmed)).toBe(false);
    // The next incremental run reads it again (short) and confirms it.
    const first = run(models, cold.census, 101, undefined, {
      listed,
      shortPages: "confirmed",
    });
    expect(first.decisions[2]).toEqual({ kind: "read", reason: "short" });
    expect(first.census.models[2]?.confirmed).toBe(true);
    // Full pages are never marked confirmed.
    expect(first.census.models[3]?.confirmed).toBe(false);
    // Later daily runs carry it with its confirmation until its own sweep
    // re-reads and confirms it again.
    let census = first.census;
    let carried = 0;
    for (let day = 102; day <= 106; day++) {
      const next = run(models, census, day, undefined, {
        listed,
        shortPages: "confirmed",
      });
      if (next.decisions[2]?.kind === "carry") carried++;
      expect(next.census.models[2]?.confirmed).toBe(true);
      census = next.census;
    }
    expect(carried).toBeGreaterThan(0);
  });

  test("a gap run confirms nothing, so a fault on the day after a failure heals the next day", () => {
    // Accepted daily to day 110. Day 111 is missed (or rejected), so day 112
    // reads every page again. A fault confined to that day lists model-2 short
    // (passing both floors) and its closing re-read repeats it. It must not be
    // stored as confirmed: the next run reads it again and heals it.
    const models = controls(12, 10);
    let census = run(models, null, 100).census;
    for (let day = 101; day <= 110; day++)
      census = run(models, census, day).census;
    const gap = run(models, census, 112, undefined, {
      listed: new Map([["model-2", 3]]),
      shortPages: "confirmed",
    });
    expect(
      gap.decisions.every((d) => d.kind === "read" && d.reason === "gap"),
    ).toBe(true);
    expect(gap.census.models.some((m) => m.confirmed)).toBe(false);
    const healed = run(models, gap.census, 113);
    expect(healed.decisions[2]).toEqual({ kind: "read", reason: "short" });
    expect(healed.census.models[2]?.page).toBe(page("model-2", 113, 10));
    // The same holds after an outage of six or more days.
    const outage = run(models, census, 116, undefined, {
      listed: new Map([["model-2", 3]]),
      shortPages: "confirmed",
    });
    expect(outage.census.models.some((m) => m.confirmed)).toBe(false);
    expect(run(models, outage.census, 117).decisions[2]).toEqual({
      kind: "read",
      reason: "short",
    });
  });

  test("a model whose count moved keeps a replay reference lowered only by its drop", () => {
    // Badges and healthy pages at 10 on 30 models. One model's count drops by
    // one while its page falls to a single card; another's count rises by one
    // while its page has not caught up yet.
    const models = controls(30, 10);
    const label = (i: number) => "M" + i;
    const census = run(models, null, 100).census;
    const today = models.map((m, i) =>
      i === 0 ? { ...m, count: 9 } : i === 1 ? { ...m, count: 11 } : m,
    );
    const pages = today.map((m, i) => page(m.key, 101, i === 0 ? 1 : 10));
    expect(
      ModelCensus.coverage(
        "Fixture",
        { controls: today, pages, previous: census, day: 101, cards },
        0.5,
        label,
      ),
    ).toBeNull();
    // Five such drops: 255 of 295 references (86%), below the replay floor,
    // while the badge floor at 0.5 passes.
    const dropped = models.map((m, i) => (i < 5 ? { ...m, count: 9 } : m));
    const cut = dropped.map((m, i) => page(m.key, 101, i < 5 ? 1 : 10));
    expect(
      ModelCensus.coverage(
        "Fixture",
        { controls: dropped, pages: cut, previous: census, day: 101, cards },
        0.5,
        label,
      ),
    ).toContain("255 of 295 cards that the last accepted census listed");
  });

  test("coverage fails when read and carried cards fall short of today's counts", () => {
    const models = controls(10, 10);
    const label = (i: number) => "M" + i;
    const full = models.map((m) => page(m.key, 100, 10));
    expect(
      ModelCensus.coverage(
        "Fixture",
        { controls: models, pages: full, previous: null, day: null, cards },
        0.95,
        label,
      ),
    ).toBeNull();
    // Surplus cards on one model never hide an empty model elsewhere.
    const shifted = full.map((p, i) =>
      i === 0
        ? page("model-0", 100, 20)
        : i === 1
          ? page("model-1", 100, 0)
          : p,
    );
    const message = ModelCensus.coverage(
      "Fixture",
      { controls: models, pages: shifted, previous: null, day: null, cards },
      0.95,
      label,
    );
    expect(message).toContain("90 of 100 cards");
    expect(message).toContain("M1 (10)");
    expect(
      ModelCensus.coverage(
        "Fixture",
        { controls: models, pages: shifted, previous: null, day: null, cards },
        0.9,
        label,
      ),
    ).toBeNull();
  });

  test("replay coverage catches a slice cut to one card even when badges overcount", () => {
    // Badges promise 10 per model but healthy pages list 9: a 90% badge
    // baseline, as on yards whose badges overcount. The badge floor must sit
    // below it, so only the replay floor can see a slice cut to one card.
    const models = controls(30, 10);
    const label = (i: number) => "M" + i;
    const nine = new Map(models.map((m) => [m.key, 9]));
    const cold = run(models, null, 100, undefined, { listed: nine });
    const healthy = models.map((m) => page(m.key, 101, 9));
    expect(
      ModelCensus.coverage(
        "Fixture",
        {
          controls: models,
          pages: healthy,
          previous: cold.census,
          day: 101,
          cards,
        },
        0.75,
        label,
      ),
    ).toBeNull();
    const broken = healthy.map((p, i) =>
      i < 5 ? page(models[i]?.key ?? "", 101, 1) : p,
    );
    // 5 of 30 models (a sixth) list one card: 230 of 300 badge cards is still
    // above a 75% badge floor ...
    expect(
      ModelCensus.coverage(
        "Fixture",
        { controls: models, pages: broken, previous: null, day: null, cards },
        0.75,
        label,
      ),
    ).toBeNull();
    // ... but only 230 of the 270 cards last accepted.
    expect(
      ModelCensus.coverage(
        "Fixture",
        {
          controls: models,
          pages: broken,
          previous: cold.census,
          day: 101,
          cards,
        },
        0.75,
        label,
      ),
    ).toContain("230 of 270 cards that the last accepted census listed");
  });

  test("a surplus page that loses cards without its count dropping is re-read, never carried", () => {
    // A badge of 3 whose healthy page lists 4 (a placeholder row).
    const models = controls(12, 3);
    const label = new Map([["model-2", 4]]);
    const cold = run(models, null, 100, undefined, { listed: label });
    // The surplus it lists is part of what it is expected to list.
    expect(cold.census.models[2]?.expected).toBe(4);
    const day = [101, 102, 103, 104, 105].find(
      (d) => ModelCensus.slice("model-2") === d % MODEL_CENSUS_SWEEP_DAYS,
    );
    if (day === undefined) throw new Error("fixture needs model-2's slice day");
    // Its sweep read lists exactly its badge: one real donor is gone.
    const dropped = run(models, cold.census, day, undefined, {
      listed: new Map([["model-2", 3]]),
    });
    // The surplus a cold run saw is unconfirmed, so the first incremental run
    // (also this model's sweep day) reads it as short.
    expect(dropped.decisions[2]).toEqual({ kind: "read", reason: "short" });
    // Closing must re-read it even though cards equal the badge.
    expect(
      ModelCensus.closingReads({
        controls: models,
        pages: dropped.pages,
        decisions: dropped.decisions,
        previous: cold.census,
        cards,
      }),
    ).toContain(2);
    expect(dropped.census.models[2]).toMatchObject({
      expected: 4,
      lowSince: day,
      confirmed: false,
    });
    // The next run re-reads it rather than carrying the drop; the page lists
    // its placeholder again.
    const next = run(models, dropped.census, day + 1, undefined, {
      listed: label,
    });
    expect(next.decisions[2]).toEqual({ kind: "read", reason: "short" });
    expect(next.census.models[2]).toMatchObject({
      expected: 4,
      lowSince: null,
    });
    // Pages matching their badge need no closing read; the recovered surplus
    // page differs from its badge, so closing re-reads only it.
    expect(
      ModelCensus.closingReads({
        controls: models,
        pages: next.pages,
        decisions: next.decisions,
        previous: dropped.census,
        cards,
      }),
    ).toEqual([2]);
  });

  test("one lagging read never erases a placeholder surplus", () => {
    // Badge 3, healthy page 4 (a placeholder). A sale removes a real card on
    // day 101 while the badge still says 3, so that read lists exactly 3. The
    // badge drops to 2 the next day. Later a fault loses a different real card
    // while the placeholder stays, listing exactly the badge again: it must
    // still be read again on the next run, not carried.
    const models = controls(12, 3);
    const placeholder = new Map([["model-2", 4]]);
    let census = run(models, null, 100, undefined, {
      listed: placeholder,
    }).census;
    // Day 101: model-2 is due (short-listed by a forced trigger) and lags.
    census = run(models, census, 101, new Set(["model-2"]), {
      listed: new Map([["model-2", 3]]),
    }).census;
    expect(census.models[2]).toMatchObject({ expected: 4, lowSince: 101 });
    // Day 102: the badge catches up to 2, so 2 donors plus the placeholder
    // list 3 again: the surplus is back.
    const sold = models.map((m, i) => (i === 2 ? { ...m, count: 2 } : m));
    census = run(sold, census, 102, undefined, {
      listed: new Map([["model-2", 3]]),
    }).census;
    expect(census.models[2]).toMatchObject({ expected: 3, lowSince: null });
    // Day 103: a fault drops a real card; the page lists exactly its badge.
    const fault = run(sold, census, 103, new Set(["model-2"]), {
      listed: new Map([["model-2", 2]]),
    });
    expect(
      ModelCensus.closingReads({
        controls: sold,
        pages: fault.pages,
        decisions: fault.decisions,
        previous: census,
        cards,
      }),
    ).toContain(2);
    expect(run(sold, fault.census, 104).decisions[2]).toEqual({
      kind: "read",
      reason: "short",
    });
  });

  test("a surplus that really went away is read daily and lowered only by an incremental run after six days", () => {
    // Badge 3, page 4 (a placeholder). The cold run's surplus is confirmed by
    // the first incremental run; the placeholder is then gone for good from
    // the model's own sweep day S.
    const models = controls(12, 3);
    const withPlaceholder = { listed: new Map([["model-2", 4]]) };
    let census = run(models, null, 100, undefined, withPlaceholder).census;
    expect(census.models[2]).toMatchObject({
      expected: 4,
      surplusConfirmed: false,
    });
    const first = run(models, census, 101, undefined, withPlaceholder);
    expect(first.decisions[2]).toEqual({ kind: "read", reason: "short" });
    expect(first.census.models[2]).toMatchObject({
      expected: 4,
      surplusConfirmed: true,
    });
    census = first.census;
    const S = [102, 103, 104, 105, 106, 107].find(
      (d) => ModelCensus.slice("model-2") === d % MODEL_CENSUS_SWEEP_DAYS,
    );
    if (S === undefined) throw new Error("fixture needs model-2's slice day");
    for (let day = 102; day < S; day++) {
      const next = run(models, census, day, undefined, withPlaceholder);
      expect(next.decisions[2]?.kind).toBe("carry");
      census = next.census;
    }
    // S to S + 5: read every run (its sweep, then short), the surplus held.
    for (let day = S; day <= S + 5; day++) {
      const next = run(models, census, day);
      expect(next.decisions[2]).toEqual({
        kind: "read",
        // Its due day reads it as sweep, or as stale when that day is six
        // days after its day 101 read; later days read it as short.
        reason:
          day === S
            ? S - 101 >= MODEL_CENSUS_SWEEP_DAYS
              ? "stale"
              : "sweep"
            : "short",
      });
      expect(next.census.models[2]).toMatchObject({
        expected: 4,
        lowSince: S,
      });
      census = next.census;
    }
    // S + 6 is missed, so S + 7 is a full gap read: six days have passed, but
    // a gap run never lowers the surplus.
    const gap = run(models, census, S + 7);
    expect(gap.decisions[2]).toEqual({ kind: "read", reason: "gap" });
    expect(gap.census.models[2]).toMatchObject({ expected: 4, lowSince: S });
    // The next normal incremental run reads it again and lowers it.
    const lowered = run(models, gap.census, S + 8);
    expect(lowered.decisions[2]).toEqual({ kind: "read", reason: "short" });
    expect(lowered.census.models[2]).toMatchObject({
      expected: 3,
      lowSince: null,
      surplusConfirmed: true,
    });
    // From then on it carries like any other model.
    const after = run(models, lowered.census, S + 9);
    expect(after.decisions[2]?.kind).toBe(
      ModelCensus.slice("model-2") === (S + 9) % MODEL_CENSUS_SWEEP_DAYS
        ? "read"
        : "carry",
    );
  });

  test("arrival lag holds the surplus window open, but never past twelve days", () => {
    // Badge 3, page 4 (a placeholder). From day 102 an arrival raises the
    // badge every day before its card appears, so each read lists exactly the
    // badge. The count has risen by at least the missing card, so this looks
    // like arrival lag: the surplus is kept past six days, and lowered only by
    // the twelve-day bound.
    let models = controls(12, 3);
    const listed = (count: number) => new Map([["model-2", count]]);
    let census = run(models, null, 100, undefined, {
      listed: listed(4),
    }).census;
    census = run(models, census, 101, undefined, { listed: listed(4) }).census;
    for (let day = 102; day <= 114; day++) {
      const count = 3 + (day - 101);
      models = models.map((m, i) => (i === 2 ? { ...m, count } : m));
      const next = run(models, census, day, undefined, {
        listed: listed(count),
      });
      expect(next.decisions[2]?.kind).toBe("read");
      expect(next.census.models[2]).toMatchObject(
        day < 102 + 2 * MODEL_CENSUS_SWEEP_DAYS
          ? { expected: count + 1, lowSince: 102 }
          : { expected: count, lowSince: null },
      );
      census = next.census;
    }
  });

  test("one arrival lagging seven days does not lower the surplus", () => {
    // Quiet model: badge 10, page 11 (a placeholder). An arrival is counted
    // on day 102 and its card appears on day 109. The window from day 102
    // must not lower the surplus on day 108, so a fault on day 109 that drops
    // another card (the page lists 11) is still caught.
    let models = controls(12, 10);
    const listed = (cards: number) => new Map([["model-2", cards]]);
    let census = run(models, null, 100, undefined, {
      listed: listed(11),
    }).census;
    census = run(models, census, 101, undefined, { listed: listed(11) }).census;
    models = models.map((m, i) => (i === 2 ? { ...m, count: 11 } : m));
    for (let day = 102; day <= 108; day++) {
      const next = run(models, census, day, undefined, { listed: listed(11) });
      expect(next.decisions[2]?.kind).toBe("read");
      expect(next.census.models[2]).toMatchObject({
        expected: 12,
        lowSince: 102,
      });
      census = next.census;
    }
    // Day 109: the arrival's card appears, but a fault drops another card.
    const fault = run(models, census, 109, undefined, { listed: listed(11) });
    expect(
      ModelCensus.closingReads({
        controls: models,
        pages: fault.pages,
        decisions: fault.decisions,
        previous: census,
        cards,
      }),
    ).toContain(2);
    expect(fault.census.models[2]).toMatchObject({ expected: 12 });
    expect(run(models, fault.census, 110).decisions[2]).toEqual({
      kind: "read",
      reason: "short",
    });
  });

  test("a placeholder removed on a busy model is lowered within twelve days, and a count fall never restarts the window", () => {
    // Badge 40, page 41 (a placeholder) until the placeholder is removed for
    // good on day 102. The badge then falls and rises every few days.
    let models = controls(12, 40);
    const at = (count: number) => new Map([["model-2", count]]);
    let census = run(models, null, 100, undefined, { listed: at(41) }).census;
    census = run(models, census, 101, undefined, { listed: at(41) }).census;
    const badge = (day: number) =>
      40 + (day >= 105 ? -1 : 0) + (day >= 109 ? 1 : 0) + (day >= 112 ? 1 : 0);
    let lowered: number | null = null;
    let windowStart: number | null = null;
    let reads = 0;
    for (let day = 102; day <= 125 && lowered === null; day++) {
      models = models.map((m, i) =>
        i === 2 ? { ...m, count: badge(day) } : m,
      );
      const next = run(models, census, day, undefined, {
        listed: at(badge(day)),
      });
      if (windowStart !== null && next.decisions[2]?.kind === "read") reads++;
      const lowSince = next.census.models[2]?.lowSince ?? null;
      // The window opens on the first read after the removal, and no later
      // count change, up or down, restarts it.
      if (lowSince !== null) {
        windowStart ??= lowSince;
        expect(lowSince).toBe(windowStart);
      } else if (windowStart !== null) lowered = day;
      census = next.census;
    }
    if (windowStart === null || lowered === null)
      throw new Error("Expected the removal to open and close a low window");
    // Read every run while the window lasts, and lowered by the twelve-day
    // bound at the latest.
    expect(lowered - windowStart).toBeLessThanOrEqual(
      2 * MODEL_CENSUS_SWEEP_DAYS,
    );
    expect(reads).toBe(lowered - windowStart);
    expect(census.models[2]).toMatchObject({
      expected: badge(lowered),
      lowSince: null,
      lowCount: null,
    });
  });

  test("a sale does not cancel an arrival's lag signal inside an open window", () => {
    // Quiet model: badge 10, page 11 (a placeholder). An arrival is counted
    // on day 102 and its card appears on day 109; a sale on day 103 takes the
    // count back to 10. The count rose by the missing card inside the window,
    // so the surplus must hold, with the window-open count, through day 108.
    let models = controls(12, 10);
    const at = (count: number, listed: number) => {
      models = models.map((m, i) => (i === 2 ? { ...m, count } : m));
      return { listed: new Map([["model-2", listed]]) };
    };
    let census = run(models, null, 100, undefined, at(10, 11)).census;
    census = run(models, census, 101, undefined, at(10, 11)).census;
    const days: [number, number, number][] = [
      // [day, count, listed]: the card lags, the sale removes a real card.
      [102, 11, 11],
      [103, 10, 10],
      [104, 10, 10],
      [105, 10, 10],
      [106, 10, 10],
      [107, 10, 10],
      [108, 10, 10],
    ];
    for (const [day, count, listed] of days) {
      const options = at(count, listed);
      const next = run(models, census, day, undefined, options);
      expect(next.decisions[2]?.kind).toBe("read");
      expect(next.census.models[2]).toMatchObject({
        expected: count + 1,
        lowSince: 102,
        lowCount: 10,
      });
      census = next.census;
    }
    // Day 109: the arrival's card appears; the surplus was never lost.
    const appeared = run(models, census, 109, undefined, at(10, 11));
    expect(appeared.census.models[2]).toMatchObject({
      expected: 11,
      lowSince: null,
      lowCount: null,
    });
  });

  test("a surplus lowered by the time bound keeps a ceiling that closing still enforces", () => {
    // Badge 3, page 4 (a real placeholder). From day 102 an arrival is counted
    // every day and its card appears a day later, so each read lists exactly
    // the badge. The twelve-day bound lowers the surplus on day 114, but the
    // old surplus stays as a ceiling: a later read below it is closing-read.
    let models = controls(12, 3);
    const at = (count: number, listed: number) => {
      models = models.map((m, i) => (i === 2 ? { ...m, count } : m));
      return { listed: new Map([["model-2", listed]]) };
    };
    const first = at(3, 4);
    let census = run(models, null, 100, undefined, first).census;
    census = run(models, census, 101, undefined, first).census;
    for (let day = 102; day <= 114; day++) {
      const count = 3 + (day - 101);
      const options = at(count, count);
      census = run(models, census, day, undefined, options).census;
    }
    expect(census.models[2]).toMatchObject({
      expected: 16,
      lowSince: null,
      ceiling: 1,
    });
    // Day 115: the count holds, so the lowered page carries until it is due.
    // When it is next read (a trigger here) a one-off fault hides a real card
    // and the page lists exactly its badge. Closing must re-read it.
    const faulty = at(16, 16);
    expect(run(models, census, 115, undefined, faulty).decisions[2]?.kind).toBe(
      "carry",
    );
    const fault = run(models, census, 115, new Set(["model-2"]), faulty);
    expect(fault.decisions[2]?.kind).toBe("read");
    expect(
      ModelCensus.closingReads({
        controls: models,
        pages: fault.pages,
        decisions: fault.decisions,
        previous: census,
        cards,
      }),
    ).toContain(2);
    // When the page lists the old surplus again, the ceiling clears and the
    // surplus returns.
    const restored = run(models, census, 115, new Set(["model-2"]), at(16, 17));
    expect(restored.census.models[2]).toMatchObject({
      expected: 17,
      ceiling: null,
    });
  });

  /** Badge 3, page 4 (a real placeholder); from day 102 an arrival is counted
   * every day and its card appears a day later, so reads list exactly the
   * badge and the twelve-day bound lowers the surplus with a ceiling of 1 on
   * day 114. Returns the models and census after day 114. */
  function laggedToCeiling(shortPages: "confirmed" | "unconfirmed") {
    let models = controls(12, 3);
    const at = (count: number, listed: number) => {
      models = models.map((m, i) => (i === 2 ? { ...m, count } : m));
      return { listed: new Map([["model-2", listed]]), shortPages };
    };
    const first = at(3, 4);
    let census = run(models, null, 100, undefined, first).census;
    census = run(models, census, 101, undefined, first).census;
    for (let day = 102; day <= 114; day++) {
      const count = 3 + (day - 101);
      const options = at(count, count);
      census = run(models, census, day, undefined, options).census;
    }
    return { models, census, at };
  }

  test("a ceiling outlives later reads below it until it expires", () => {
    const { models, census: lowered, at } = laggedToCeiling("confirmed");
    expect(lowered.models[2]).toMatchObject({ ceiling: 1, ceilingSince: 114 });
    // Day 115: a read lists exactly the badge (below the ceiling) and closing
    // repeats it. The ceiling stays.
    const quiet = at(16, 16);
    const below = run(models, lowered, 115, new Set(["model-2"]), quiet);
    expect(below.census.models[2]).toMatchObject({
      expected: 16,
      ceiling: 1,
      ceilingSince: 114,
    });
    // Day 116: a later one-off fault listing exactly the badge is still
    // closing-read.
    const fault = run(models, below.census, 116, new Set(["model-2"]), quiet);
    expect(
      ModelCensus.closingReads({
        controls: models,
        pages: fault.pages,
        decisions: fault.decisions,
        previous: below.census,
        cards,
      }),
    ).toContain(2);
  });

  test("a ceiling for a placeholder that is really gone expires after twelve run days", () => {
    // The placeholder is gone for good, but the badge keeps changing every day,
    // so the page is read daily. Closing re-reads it while the ceiling stands,
    // then stops once the ceiling expires.
    const { models: start, census: lowered } = laggedToCeiling("confirmed");
    let models = start;
    let census = lowered;
    const closingDays: number[] = [];
    for (let day = 115; day <= 140; day++) {
      const count = 16 + (day % 2);
      models = models.map((m, i) => (i === 2 ? { ...m, count } : m));
      const next = run(models, census, day, undefined, {
        listed: new Map([["model-2", count]]),
      });
      expect(next.decisions[2]?.kind).toBe("read");
      if (
        ModelCensus.closingReads({
          controls: models,
          pages: next.pages,
          decisions: next.decisions,
          previous: census,
          cards,
        }).includes(2)
      )
        closingDays.push(day);
      census = next.census;
    }
    // Set on day 114 and dropped by the day 126 acceptance; closing reads
    // use the previous census, so twelve runs (115 to 126) re-read it.
    expect(closingDays).toEqual(
      Array.from({ length: 2 * MODEL_CENSUS_SWEEP_DAYS }, (_, i) => 115 + i),
    );
    expect(census.models[2]).toMatchObject({
      ceiling: null,
      ceilingSince: null,
    });
  });

  test("without a closing pass, a read below the ceiling is read again until two reads agree", () => {
    // The Calton mode: no closing re-read. The read that lowers the surplus is
    // itself below the ceiling, so the next run reads the page again.
    const { models, census: lowered, at } = laggedToCeiling("unconfirmed");
    expect(lowered.models[2]).toMatchObject({ ceiling: 1, recheck: true });
    const lag = at(16, 16);
    const agreed = run(models, lowered, 115, undefined, lag);
    expect(agreed.decisions[2]).toEqual({ kind: "read", reason: "short" });
    expect(agreed.census.models[2]).toMatchObject({ recheck: false });
    // Day 116: the lag drains (the page should list 17), but a one-off fault
    // hides a real card and the page lists 16, below the ceiling.
    const fault = run(models, agreed.census, 116, new Set(["model-2"]), lag);
    expect(fault.census.models[2]).toMatchObject({ recheck: true });
    // Day 117 reads it again; the healthy page restores the surplus.
    const healed = run(models, fault.census, 117, undefined, at(16, 17));
    expect(healed.decisions[2]).toEqual({ kind: "read", reason: "short" });
    expect(healed.census.models[2]).toMatchObject({
      expected: 17,
      ceiling: null,
      recheck: false,
    });
    // A re-read that disagrees (a fault on the re-read itself) asks again.
    const disagree = run(models, lowered, 115, undefined, at(16, 15));
    expect(disagree.census.models[2]).toMatchObject({ recheck: true });
  });

  test("without a closing pass, a re-read with the same count but other cards is read again", () => {
    // Day 114 lowered the surplus while the page listed 16 real cards. On the
    // day 115 re-read the placeholder returns and a one-off fault hides a real
    // card: 16 again, but not the same cards. It must not settle the recheck.
    const { models, census: lowered, at } = laggedToCeiling("unconfirmed");
    const swapped = run(models, lowered, 115, undefined, {
      ...at(16, 16),
      tags: new Map([["model-2", "placeholder-back-one-real-hidden"]]),
    });
    expect(swapped.decisions[2]).toEqual({ kind: "read", reason: "short" });
    expect(swapped.census.models[2]).toMatchObject({ recheck: true });
    const next = run(models, swapped.census, 116, undefined, at(16, 17));
    expect(next.decisions[2]).toEqual({ kind: "read", reason: "short" });
  });

  test("without a closing pass, a ceiling is enforced on the same run days as closing", () => {
    // The badge changes every day so the page is read daily and lists exactly
    // its badge, below the ceiling set on day 114. Closing would re-read it on
    // days 115 to 126; the no-closing mode must flag the same reads.
    const { models: start, census: lowered } = laggedToCeiling("unconfirmed");
    let models = start;
    let census = lowered;
    const recheckDays: number[] = [];
    for (let day = 115; day <= 140; day++) {
      const count = 16 + (day % 2);
      models = models.map((m, i) => (i === 2 ? { ...m, count } : m));
      census = run(models, census, day, undefined, {
        listed: new Map([["model-2", count]]),
        shortPages: "unconfirmed",
      }).census;
      if (census.models[2]?.recheck) recheckDays.push(day);
    }
    expect(recheckDays).toEqual(
      Array.from({ length: 2 * MODEL_CENSUS_SWEEP_DAYS }, (_, i) => 115 + i),
    );
  });

  test("a carried ceiling holds until twelve run days after it was set", () => {
    // model-2 is in sweep slice 5: lowered on day 114, it is read on days 119,
    // 125 and 131 and carried on the others. The count holds at its badge.
    expect(ModelCensus.slice("model-2")).toBe(5);
    const { models, census: lowered } = laggedToCeiling("confirmed");
    let census = lowered;
    const readDays: number[] = [];
    const closingDays: number[] = [];
    const carried: [number, number | null][] = [];
    for (let day = 115; day <= 130; day++) {
      const next = run(models, census, day);
      if (next.decisions[2]?.kind === "read") readDays.push(day);
      else carried.push([day, next.census.models[2]?.ceiling ?? null]);
      if (
        ModelCensus.closingReads({
          controls: models,
          pages: next.pages,
          decisions: next.decisions,
          previous: census,
          cards,
        }).includes(2)
      )
        closingDays.push(day);
      census = next.census;
    }
    expect(readDays).toEqual([119, 125]);
    // The first read from day 120 (ceilingSince + 6) is still closing-read.
    expect(closingDays).toEqual([119, 125]);
    // Carried evidence keeps the ceiling through day 125 and drops it from
    // day 126 (ceilingSince + 12).
    expect(carried).toEqual(
      [
        115, 116, 117, 118, 120, 121, 122, 123, 124, 126, 127, 128, 129, 130,
      ].map((day): [number, number | null] => [day, day < 126 ? 1 : null]),
    );
    expect(census.models[2]).toMatchObject({
      ceiling: null,
      ceilingSince: null,
    });
  });

  test("a surplus that grows on a gap or outage read is unconfirmed until an incremental run sees it", () => {
    // Badge 3, page 4, confirmed on day 101. Day 102 is missed; the day 103
    // gap read lists 5 (surplus 2). It must not inherit the earlier
    // confirmation, so the next incremental run reads it again.
    const models = controls(12, 3);
    const at = (cards: number) => new Map([["model-2", cards]]);
    let census = run(models, null, 100, undefined, { listed: at(4) }).census;
    census = run(models, census, 101, undefined, { listed: at(4) }).census;
    expect(census.models[2]).toMatchObject({ surplusConfirmed: true });
    const gap = run(models, census, 103, undefined, { listed: at(5) });
    expect(gap.decisions[2]).toEqual({ kind: "read", reason: "gap" });
    expect(gap.census.models[2]).toMatchObject({
      expected: 5,
      surplusConfirmed: false,
    });
    expect(run(models, gap.census, 104).decisions[2]).toEqual({
      kind: "read",
      reason: "short",
    });
    // A full read that sees the same confirmed surplus keeps its confirmation.
    const same = run(models, census, 103, undefined, { listed: at(4) });
    expect(same.census.models[2]).toMatchObject({
      expected: 4,
      surplusConfirmed: true,
    });
  });

  test("a surplus page that loses a donor on the day its count changes is still re-read", () => {
    // Badge 3, healthy page 4 (a placeholder row). On day 101 an arrival
    // raises the badge to 4 while one real donor is missing: the page lists 4.
    const models = controls(12, 3);
    const cold = run(models, null, 100, undefined, {
      listed: new Map([["model-2", 4]]),
    });
    const grown = models.map((m, i) => (i === 2 ? { ...m, count: 4 } : m));
    expect(ModelCensus.expected(grown, cold.census)[2]).toBe(5);
    const day = run(grown, cold.census, 101, undefined, {
      listed: new Map([["model-2", 4]]),
    });
    expect(day.decisions[2]).toEqual({ kind: "read", reason: "count" });
    expect(
      ModelCensus.closingReads({
        controls: grown,
        pages: day.pages,
        decisions: day.decisions,
        previous: cold.census,
        cards,
      }),
    ).toContain(2);
    expect(day.census.models[2]).toMatchObject({
      expected: 5,
      confirmed: false,
    });
    expect(run(grown, day.census, 102).decisions[2]).toEqual({
      kind: "read",
      reason: "short",
    });
  });

  test("steady daily runs keep routine sweep reads, read at age six, under the replay floor", () => {
    // After the first cycle every routine sweep read happens at age exactly
    // six (reason stale). Those reads must still be checked against the
    // pages they replace, or a slice cut to one card would pass.
    const models = controls(60, 10);
    const label = (i: number) => "M" + i;
    let census = run(models, null, 100).census;
    for (let day = 101; day <= 111; day++)
      census = run(models, census, day).census;
    const today = 112;
    const decisions = ModelCensus.plan(models, census, today, {
      cards,
      reuse: "unchanged-key",
    });
    const due = decisions.flatMap((d, i) => (d.kind === "read" ? [i] : []));
    expect(due.length).toBeGreaterThan(0);
    expect(
      decisions.every((d) => d.kind === "carry" || d.reason === "stale"),
    ).toBe(true);
    const pages = decisions.map((d, i) =>
      d.kind === "carry"
        ? d.evidence.page
        : page(models[i]?.key ?? "", today, 1),
    );
    expect(
      ModelCensus.coverage(
        "Fixture",
        { controls: models, pages, previous: census, day: today, cards },
        0.8,
        label,
      ),
    ).toContain("last accepted census");
  });

  test("a replay rejection holds on every later run until the last accepted run is six days old", () => {
    // 60 models, badges and healthy pages at 10. Daily runs to day 110 are
    // accepted. From day 111 the slice due that day lists one card per page
    // (85% of badges, above a 0.8 badge floor). Rejected runs accept nothing,
    // so the previous census stays at day 110 and the broken models age past
    // six days; they must keep their replay reference until the outage path.
    const models = controls(60, 10);
    const label = (i: number) => "M" + i;
    let census = run(models, null, 100).census;
    for (let day = 101; day <= 110; day++)
      census = run(models, census, day).census;
    const broken = new Set(
      models
        .filter(
          (m) => ModelCensus.slice(m.key) === 111 % MODEL_CENSUS_SWEEP_DAYS,
        )
        .map((m) => m.key),
    );
    expect(broken.size).toBeGreaterThan(0);
    const attempt = (today: number) => {
      const decisions = ModelCensus.plan(models, census, today, {
        cards,
        reuse: "unchanged-key",
      });
      const pages = decisions.map((d, i) => {
        const key = models[i]?.key ?? "";
        if (d.kind === "carry") return d.evidence.page;
        return page(key, today, broken.has(key) ? 1 : 10);
      });
      return ModelCensus.coverage(
        "Fixture",
        { controls: models, pages, previous: census, day: today, cards },
        0.8,
        label,
      );
    };
    // The first broken day and every retry with gaps of 2 to 5 days.
    for (const today of [111, 112, 113, 114, 115])
      expect(attempt(today)).toContain("last accepted census");
    // Once the last accepted run is six days old the run is judged like a
    // cold run: a real drop clears within that bound instead of blocking.
    expect(attempt(116)).toBeNull();
  });

  test("a missed run never lets a broken due slice skip the replay floor", () => {
    // Accepted daily to day 110, no run on day 111, then day 112 reads both
    // the day 111 slice (now age seven) and its own; the day 111 slice lists
    // one card per page.
    const models = controls(60, 10);
    const label = (i: number) => "M" + i;
    let census = run(models, null, 100).census;
    for (let day = 101; day <= 110; day++)
      census = run(models, census, day).census;
    const late = (m: ModelCensusControl) =>
      ModelCensus.slice(m.key) === 111 % MODEL_CENSUS_SWEEP_DAYS;
    const decisions = ModelCensus.plan(models, census, 112, {
      cards,
      reuse: "unchanged-key",
    });
    const pages = decisions.map((d, i) => {
      const model = models[i];
      if (!model) throw new Error("fixture decision has no model");
      if (d.kind === "carry") return d.evidence.page;
      return page(model.key, 112, late(model) ? 1 : 10);
    });
    expect(
      ModelCensus.coverage(
        "Fixture",
        { controls: models, pages, previous: census, day: 112, cards },
        0.8,
        label,
      ),
    ).toContain("last accepted census");
  });

  test("a recovery run after a six-day outage is judged like a cold run", () => {
    // Badges 10, healthy pages 10, accepted on day 100. After a six-day gap
    // every page is read and lists 9: above an 85% badge floor, below replay.
    const models = controls(30, 10);
    const label = (i: number) => "M" + i;
    const cold = run(models, null, 100);
    const nine = models.map((m) => page(m.key, 106, 9));
    const covered = (day: number) =>
      ModelCensus.coverage(
        "Fixture",
        { controls: models, pages: nine, previous: cold.census, day, cards },
        0.85,
        label,
      );
    // Five days after the last accepted run the replay floor still applies ...
    expect(covered(105)).toContain("last accepted census");
    // ... but once the last accepted run is six days old every page is read
    // again and the run is judged on the badge floor alone.
    expect(
      run(models, cold.census, 106).decisions.every((d) => d.kind === "read"),
    ).toBe(true);
    expect(covered(106)).toBeNull();
  });

  test("a second run on the same day carries what the first run read", () => {
    const models = controls(12);
    const first = run(models, run(models, null, 100).census, 101);
    const again = run(models, first.census, 101);
    expect(reads(again.decisions)).toEqual([]);
  });

  test("the schema rejects repeated, future and over-age evidence", () => {
    const schema = ModelCensus.schema(z.string(), 10);
    const valid = run(controls(3), null, 100).census;
    expect(schema.parse(valid)).toEqual(valid);
    const [first] = valid.models;
    if (!first) throw new Error("fixture census is empty");
    expect(() => schema.parse({ ...valid, models: [first, first] })).toThrow(
      "repeats",
    );
    expect(() =>
      schema.parse({ ...valid, models: [{ ...first, readDay: 101 }] }),
    ).toThrow("six-day");
    expect(() =>
      schema.parse({ ...valid, models: [{ ...first, readDay: 94 }] }),
    ).toThrow("six-day");
  });

  test("helpers walk carried runs and summarize reasons", () => {
    const models = controls(12);
    const next = run(models, run(models, null, 100).census, 101);
    const first = ModelCensus.nextRead(next.decisions, 0);
    expect(next.decisions[first]?.kind).toBe("read");
    expect(ModelCensus.carriedRun(next.decisions, 0)).toHaveLength(first);
    const swept = reads(next.decisions).length;
    expect(ModelCensus.summary(next.decisions)).toBe(
      `Read ${swept} of 12 model pages (sweep ${swept}); carried ${12 - swept}.`,
    );
    expect(() =>
      ModelCensus.accept(
        contract,
        101,
        {
          controls: models,
          pages: [],
          decisions: next.decisions,
          previous: null,
          cards,
        },
        "confirmed",
      ),
    ).toThrow("cannot close");
  });
});

describe("ModelCensus with reuse never", () => {
  const never = { reuse: "never" } as const;

  test("every incremental run reads every model page, so nothing is carried", () => {
    const models = controls(240);
    let census = run(models, null, 100, undefined, never).census;
    for (let day = 101; day <= 100 + 2 * MODEL_CENSUS_SWEEP_DAYS; day++) {
      const next = run(models, census, day, undefined, never);
      expect(
        next.decisions.every((d) => d.kind === "read" && d.reason === "daily"),
      ).toBe(true);
      expect(next.census.models.every((m) => m.readDay === day)).toBe(true);
      census = next.census;
    }
  });

  test("a second run on the same day reads every model page again", () => {
    const models = controls(12);
    const first = run(
      models,
      run(models, null, 100, undefined, never).census,
      101,
      undefined,
      never,
    );
    const again = run(models, first.census, 101, undefined, never);
    expect(reads(again.decisions)).toEqual(models.map((_, i) => i));
  });

  test("reads keep their count, trigger, new and short reasons", () => {
    const models = controls(12);
    const cold = run(models, null, 100, undefined, {
      ...never,
      listed: new Map([["model-5", 2]]),
      shortPages: "unconfirmed",
    });
    const changed = [
      ...models.map((m, i) => (i === 3 ? { ...m, count: 4 } : m)),
      { key: "model-new", count: 1 },
    ];
    const next = run(changed, cold.census, 101, new Set(["model-7"]), never);
    expect(next.decisions[3]).toEqual({ kind: "read", reason: "count" });
    expect(next.decisions[5]).toEqual({ kind: "read", reason: "short" });
    expect(next.decisions[7]).toEqual({ kind: "read", reason: "trigger" });
    expect(next.decisions.at(-1)).toEqual({ kind: "read", reason: "new" });
    expect(next.decisions[0]).toEqual({ kind: "read", reason: "daily" });
    expect(ModelCensus.summary(next.decisions)).toBe(
      "Read 13 of 13 model pages (daily 9, count 1, short 1, trigger 1, new 1); carried 0.",
    );
  });

  test("a gap still reads every page as a gap run", () => {
    const models = controls(6);
    const cold = run(models, null, 100, undefined, never);
    expect(
      run(models, cold.census, 103, undefined, never).decisions.every(
        (d) => d.kind === "read" && d.reason === "gap",
      ),
    ).toBe(true);
  });
});
