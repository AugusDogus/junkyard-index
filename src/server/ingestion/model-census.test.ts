import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  MODEL_CENSUS_SWEEP_DAYS,
  ModelCensus,
  type ModelCensus as ModelCensusState,
  type ModelCensusControl,
  type ModelCensusDecision,
} from "./model-census";

const contract = "fixture-contract";
const controls = (n: number, count = 3): ModelCensusControl[] =>
  Array.from({ length: n }, (_, i) => ({ key: "model-" + i, count }));
const page = (key: string, day: number) => key + "@" + day;
const reads = (decisions: readonly ModelCensusDecision<string>[]) =>
  decisions.flatMap((d, i) => (d.kind === "read" ? [i] : []));

/** Runs one census day: reads produce fresh pages, carries reuse evidence. */
function run(
  models: readonly ModelCensusControl[],
  previous: ModelCensusState<string> | null,
  day: number,
  triggers?: ReadonlySet<string>,
) {
  const decisions = ModelCensus.plan(models, previous, day, triggers);
  const pages = decisions.map((d, i) =>
    d.kind === "carry" ? d.evidence.page : page(models[i]?.key ?? "", day),
  );
  return {
    decisions,
    census: ModelCensus.accept(contract, day, models, pages, decisions),
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
      expect(evidence.page).toBe(page(evidence.key, 100));
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
    const late = run(models, cold.census, 106);
    expect(late.decisions.every((d) => d.kind === "read")).toBe(true);
    expect(
      late.decisions.every((d) => d.kind === "read" && d.reason === "stale"),
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
      ModelCensus.accept(contract, 101, models, [], next.decisions),
    ).toThrow("cannot close");
  });
});
