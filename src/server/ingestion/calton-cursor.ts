import { z } from "zod";
import {
  CALTON_MAKES,
  CALTON_ROOT,
  CaltonContractSchema,
  caltonBoundary,
  caltonControlUrl,
  caltonHash,
  type CaltonContract,
  type CaltonResult,
} from "./calton-contract";
import { CALTON_MAX_BODY_BYTES } from "./calton-client";
import { caltonOwnedUrl, caltonText } from "./calton-html";
import {
  CaltonContextSchema,
  CaltonControlSchema,
  CaltonRecordSchema,
  caltonDonorParents,
  type CaltonRecord,
} from "./calton-record";
import type { CaltonPage } from "./calton-parser";
import {
  ModelCensus,
  type ModelCensusControl,
  type ModelCensusDecision,
} from "./model-census";

/** Observed graph: 679 request nodes, 630 model pages and about 12.8k rows.
 * Native WordPress chrome already exceeds 111 MB at 532 captured pages.
 * Parsed pages take about 1 KB per donor row (498-row Accord: 515 KB), so the
 * previous census plus this run's pages is about 27 MB at 12.9k rows. */
export const CALTON_MAX_REQUESTS = 2048;
export const CALTON_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
export const CALTON_MAX_CURSOR_BYTES = 64 * 1024 * 1024;
/** Census contract for model pages carried between accepted runs. Bump it when
 * page parsing, page validation or the census key changes. */
const CENSUS_AUTHORITY =
  "calton/literal-model-graph/root-arrivals-union/incremental-model-census-v3";
const censusContract = (scope: string) => CENSUS_AUTHORITY + "/" + scope;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const controls = z.array(CaltonControlSchema).min(1).max(1536);
const directory = z
  .object({
    sourceUrl: z.string(),
    controls,
    continuationControls: z.array(z.string()),
    bodyHash: hash,
    bytes: z.number().int().positive().max(CALTON_MAX_BODY_BYTES),
  })
  .strict();
const menu = z.object({ make: CaltonControlSchema, directory }).strict();
export type CaltonMenu = z.infer<typeof menu>;
const count = {
  advertised: z.number().int().nonnegative().safe(),
  observed: z.number().int().nonnegative().safe(),
};
const page = z
  .object({
    sourceUrl: z.string(),
    context: CaltonContextSchema,
    bytes: z.number().int().positive().max(CALTON_MAX_BODY_BYTES),
    bodyHash: hash,
    records: z.array(CaltonRecordSchema).max(50_000),
    continuationControls: z.array(z.string()),
    nativeEmptyResult: z.string().nullable(),
    countCheck: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("unbound") }).strict(),
      z.object({ kind: z.enum(["matches", "mismatch"]), ...count }).strict(),
    ]),
  })
  .strict();
type CaltonCensusPage = z.infer<typeof page>;
/** Every model page of an accepted run, carried forward by the next one. */
const CaltonCensusSchema = ModelCensus.schema(page, 1536);
export type CaltonCensus = z.infer<typeof CaltonCensusSchema>;
const base = {
  source: z.literal("calton"),
  version: z.literal(1),
  scope: hash,
  checksum: hash,
  requests: z.number().int().min(0).max(CALTON_MAX_REQUESTS),
  bytes: z.number().int().min(0).max(CALTON_MAX_TOTAL_BYTES),
};
const run = {
  ...base,
  /** UTC run day fixed before the first request; null only in the initial cursor. */
  day: z.number().int().nonnegative().safe().nullable(),
  /** Compatible census from the last accepted run, or null for a cold census. */
  previous: CaltonCensusSchema.nullable(),
};
const arrivals = { arrivals: page };
const graph = { ...arrivals, makes: directory, menus: z.array(menu).max(256) };
/** Model pages in published order: native reads and carried census evidence. */
const models = { ...graph, pages: z.array(page).max(1536) };
const schema = z.discriminatedUnion("phase", [
  z.object({ ...run, phase: z.literal("arrivals") }).strict(),
  z.object({ ...run, ...arrivals, phase: z.literal("directory") }).strict(),
  z.object({ ...run, ...graph, phase: z.literal("menus") }).strict(),
  z.object({ ...run, ...models, phase: z.enum(["models", "ready"]) }).strict(),
  z
    .object({
      ...base,
      phase: z.literal("complete"),
      // Pre-incremental terminal cursors stay readable but seed a cold census.
      census: CaltonCensusSchema.optional(),
    })
    .strict(),
]);
export type CaltonCursor = z.infer<typeof schema>;
export const caltonModels = (menus: readonly CaltonMenu[]) =>
  menus.flatMap(({ make, directory }) =>
    directory.controls.map((model) => ({ make, model })),
  );

/** The census key binds every context field a model page is parsed and
 * validated under except the parent make badge, which no parser, assessment
 * or snapshot reads. Binding it would re-read every model of a make whenever
 * any sibling changes. The model badge is the census count. */
function censusControls(menus: readonly CaltonMenu[]): ModelCensusControl[] {
  return caltonModels(menus).map(({ make, model }) => ({
    key: JSON.stringify([
      make.path,
      make.literal,
      make.label,
      model.path,
      model.literal,
      model.label,
    ]),
    count: model.count,
  }));
}
const donorDestinations = (record: CaltonRecord) =>
  record.destinations.flatMap(({ literal }) => {
    const url =
      literal === null
        ? null
        : caltonOwnedUrl(caltonText(literal), record.sourceUrl);
    return url && /^\/parts\/[^/]+\/[^/]+\/[^/]+\/\d{4}$/.test(url.pathname)
      ? [url]
      : [];
  });
interface CaltonCensusState {
  arrivals: CaltonCensusPage;
  menus: readonly CaltonMenu[];
  previous: CaltonCensus | null;
  day: number | null;
}

/** Read or carry each published model. A carried model is also read when a
 * root arrival's own donor destination binds to it but its carried page lacks
 * that destination. Arrivals are only a trigger, never a delta. */
export function caltonCensusPlan(
  state: CaltonCensusState,
): ModelCensusDecision<CaltonCensusPage>[] {
  if (state.day === null) throw new Error("Census plan needs a run day");
  const published = caltonModels(state.menus);
  const controls = censusControls(state.menus);
  const carried = new Map(
    (state.previous?.models ?? []).map((m) => [m.key, m.page]),
  );
  const triggers = new Set<string>();
  for (const url of state.arrivals.records.flatMap(donorDestinations)) {
    const parent = url.pathname.split("/").slice(0, 4).join("/");
    const key =
      controls[
        published.findIndex(({ model }) =>
          caltonDonorParents(model.path).includes(parent),
        )
      ]?.key;
    if (
      key &&
      !carried
        .get(key)
        ?.records.some((record) =>
          donorDestinations(record).some(({ href }) => href === url.href),
        )
    )
      triggers.add(key);
  }
  return ModelCensus.plan(controls, state.previous, state.day, {
    cards: caltonCards,
    triggers,
  });
}

/** Cards a model page lists: the count `countCheck` compares with its badge. */
const caltonCards = (page: CaltonCensusPage) => page.records.length;
/** Minimum share of today's model badges the read and carried model cards must
 * cover, each model capped at its badge. The November 13 capture covers
 * 12,856 of 12,857 model badge cards (99.99%) on 630 models: the only short
 * model is the native-empty `CHEVROLET_PASS.` (badge 1, no rows), and 22
 * models list one row above their badge. A changed badge forces a read, so
 * carried pages add no lag. Emptying any one sweep slice of that capture
 * leaves 78.6% to 87.9%. Cutting one to a single card per model leaves 79.4%
 * to 88.8% of both the badges and the 12,879 accepted cards the shared replay
 * floor checks, below both floors on the first broken day. */
export const CALTON_MINIMUM_BADGE_COVERAGE = 0.95;
const checksum = (cursor: CaltonCursor) =>
  caltonHash({ ...cursor, checksum: undefined });

function validatePage(entry: CaltonPage, expected: CaltonPage["context"]) {
  if (
    caltonHash(entry.context) !== caltonHash(expected) ||
    entry.sourceUrl !== expected.sourceUrl ||
    entry.continuationControls.length ||
    entry.records.some(
      (record, index) =>
        record.ordinal !== index ||
        record.sourceUrl !== entry.sourceUrl ||
        caltonHash(record.context) !== caltonHash(expected),
    )
  )
    throw new Error(
      "Checkpoint page has a changed source, parent, record ordinal or unread continuation",
    );
  if (
    entry.records.length === 0
      ? entry.nativeEmptyResult !==
        "No Results.. Try Browsing Our Parts Or Search Again"
      : entry.nativeEmptyResult !== null
  )
    throw new Error(
      "Checkpoint empty-result evidence contradicts its donor rows",
    );
  const expectedCount =
    expected.kind === "arrivals"
      ? { kind: "unbound" }
      : {
          kind:
            entry.records.length === expected.model.count
              ? "matches"
              : "mismatch",
          advertised: expected.model.count,
          observed: entry.records.length,
        };
  if (caltonHash(entry.countCheck) !== caltonHash(expectedCount))
    throw new Error("Checkpoint native count observation changed");
}
function validate(input: unknown, contract: CaltonContract): CaltonCursor {
  const qualification = CaltonContractSchema.parse(contract);
  if (Buffer.byteLength(JSON.stringify(input)) > CALTON_MAX_CURSOR_BYTES)
    throw new Error(
      "Checkpoint exceeds the 64 MiB bound for the native corpus",
    );
  const cursor = schema.parse(input);
  if (
    cursor.scope !== caltonHash(qualification) ||
    cursor.checksum !== checksum(cursor)
  )
    throw new Error(
      "Checkpoint integrity, source or qualification contract changed",
    );
  if (cursor.phase === "complete") {
    // Root, make directory and one make menu; every model page may be carried.
    if (
      cursor.requests < (cursor.census ? 3 : 4) ||
      cursor.bytes < cursor.requests
    )
      throw new Error(
        "Terminal checkpoint has invalid request/byte accounting",
      );
    return cursor;
  }
  if (
    cursor.day === null
      ? cursor.requests !== 0 || cursor.previous !== null
      : cursor.previous !== null &&
        (cursor.previous.contract !== censusContract(cursor.scope) ||
          cursor.previous.day > cursor.day)
  )
    throw new Error(
      "Checkpoint run day or previous model census is inconsistent",
    );
  let expectedRequests = 0,
    expectedBytes = 0;
  if ("arrivals" in cursor) {
    validatePage(cursor.arrivals, { kind: "arrivals", sourceUrl: CALTON_ROOT });
    expectedRequests++;
    expectedBytes += cursor.arrivals.bytes;
  }
  if ("makes" in cursor) {
    if (
      cursor.makes.sourceUrl !== CALTON_MAKES ||
      cursor.makes.continuationControls.length ||
      cursor.makes.controls.length > 256 ||
      new Set(cursor.makes.controls.map((control) => control.path)).size !==
        cursor.makes.controls.length ||
      cursor.makes.controls.some((control) => !caltonControlUrl(control, 2))
    )
      throw new Error(
        "Checkpoint make graph is foreign, duplicated, oversized or unread",
      );
    expectedRequests++;
    expectedBytes += cursor.makes.bytes;
    if (
      cursor.menus.length > cursor.makes.controls.length ||
      (cursor.phase === "menus"
        ? cursor.menus.length >= cursor.makes.controls.length
        : cursor.menus.length !== cursor.makes.controls.length)
    )
      throw new Error(
        "Checkpoint model menus are not a contiguous complete make prefix",
      );
    cursor.menus.forEach((entry, index) => {
      const make = cursor.makes.controls[index];
      if (
        !make ||
        caltonHash(entry.make) !== caltonHash(make) ||
        entry.directory.sourceUrl !== caltonControlUrl(make, 2) ||
        entry.directory.continuationControls.length ||
        entry.directory.controls.some(
          (model) =>
            !caltonControlUrl(model, 3) ||
            !model.path.startsWith(make.path + "/"),
        )
      )
        throw new Error(
          "Checkpoint menu changed its literal published parent or contains unread controls",
        );
      expectedRequests++;
      expectedBytes += entry.directory.bytes;
    });
    const published = caltonModels(cursor.menus);
    if (
      published.length > 1536 ||
      new Set(published.map(({ model }) => model.path)).size !==
        published.length
    )
      throw new Error("Checkpoint repeats or exceeds the bounded model graph");
    if ("pages" in cursor) {
      if (
        cursor.phase === "ready"
          ? cursor.pages.length !== published.length
          : cursor.pages.length >= published.length
      )
        throw new Error(
          "Checkpoint donor pages are not the required published-model prefix",
        );
      // Re-derive every decision; carried pages are exactly the previous
      // census evidence and cost no request or bytes.
      const decisions = caltonCensusPlan(cursor);
      cursor.pages.forEach((entry, index) => {
        const context = published[index];
        const sourceUrl = context ? caltonControlUrl(context.model, 3) : null;
        const decision = decisions[index];
        if (!context || !sourceUrl || !decision)
          throw new Error("Checkpoint donor page has no literal model control");
        if (decision.kind === "read") {
          validatePage(entry, { kind: "model", sourceUrl, ...context });
          expectedRequests++;
          expectedBytes += entry.bytes;
          return;
        }
        if (caltonHash(entry) !== caltonHash(decision.evidence.page))
          throw new Error(
            "Checkpoint carried model page differs from its accepted census evidence",
          );
        // Carried evidence keeps the make badge it was read under.
        validatePage(entry, {
          kind: "model",
          sourceUrl,
          make:
            entry.context.kind === "model"
              ? { ...context.make, count: entry.context.make.count }
              : context.make,
          model: context.model,
        });
      });
      if (
        cursor.phase === "models" &&
        decisions[cursor.pages.length]?.kind !== "read"
      )
        throw new Error("Checkpoint next model page is not due for a read");
    }
  }
  if (cursor.requests !== expectedRequests || cursor.bytes !== expectedBytes)
    throw new Error(
      "Checkpoint request/byte accounting differs from its validated native prefix",
    );
  return cursor;
}
function checkpoint(input: unknown, contract: CaltonContract): CaltonCursor {
  const unsigned = schema.parse({
    ...z.record(z.string(), z.unknown()).parse(input),
    checksum: "0".repeat(64),
  });
  return validate({ ...unsigned, checksum: checksum(unsigned) }, contract);
}
export const CaltonCursor = {
  initial(contract: CaltonContract): CaltonResult<CaltonCursor> {
    return caltonBoundary("initial checkpoint", () =>
      checkpoint(
        {
          source: "calton",
          version: 1,
          scope: caltonHash(CaltonContractSchema.parse(contract)),
          requests: 0,
          bytes: 0,
          phase: "arrivals",
          day: null,
          previous: null,
        },
        contract,
      ),
    );
  },
  parse(input: unknown, contract: CaltonContract) {
    return caltonBoundary("checkpoint", () => validate(input, contract));
  },
  /** Fixes the run day and adopts the last accepted census before the first
   * request. Anything unusable starts a cold census with a warning; a missing
   * previous cursor is a silent cold start. */
  begin(
    cursor: CaltonCursor,
    now: number,
    previousCursor: unknown,
    contract: CaltonContract,
  ): CaltonResult<{ cursor: CaltonCursor; warning: string | null }> {
    return caltonBoundary("model census start", () => {
      if (cursor.phase === "complete" || cursor.day !== null)
        return { cursor, warning: null };
      const day = ModelCensus.day(now);
      const parsed =
        previousCursor === null || previousCursor === undefined
          ? null
          : caltonBoundary("previous checkpoint", () =>
              validate(previousCursor, contract),
            );
      const previous =
        parsed === null
          ? { kind: "cold" as const, warning: null }
          : parsed.ok && parsed.value.phase === "complete"
            ? ModelCensus.previous(
                parsed.value.census,
                censusContract(cursor.scope),
                day,
              )
            : {
                kind: "cold" as const,
                warning: `Previous Calton checkpoint is not a readable terminal census (${parsed.ok ? "phase " + parsed.value.phase : parsed.error.message}); reading every model page.`,
              };
      return {
        cursor: checkpoint(
          {
            ...cursor,
            day,
            previous: previous.kind === "incremental" ? previous.census : null,
          },
          contract,
        ),
        warning: previous.kind === "cold" ? previous.warning : null,
      };
    });
  },
  /** Terminal census and its run summary for a fully read or carried graph. */
  census(
    cursor: Extract<CaltonCursor, { phase: "models" | "ready" }>,
  ): CaltonResult<{ census: CaltonCensus; summary: string }> {
    return caltonBoundary("model census close", () => {
      if (cursor.phase !== "ready" || cursor.day === null)
        throw new Error("Only a ready graph with a run day closes a census");
      const decisions = caltonCensusPlan(cursor);
      return {
        census: ModelCensus.accept(
          censusContract(cursor.scope),
          cursor.day,
          {
            controls: censusControls(cursor.menus),
            pages: cursor.pages,
            decisions,
            previous: cursor.previous,
            cards: caltonCards,
          },
          // Calton has no closing pass: a page read today below its badge or
          // its previous surplus card count is read again on the next run
          // instead of being carried.
          "unconfirmed",
        ),
        summary: ModelCensus.summary(decisions),
      };
    });
  },
  /** Fails a ready graph whose read and carried model cards fall short of
   * today's model badges, before any snapshot, callback or terminal census. */
  coverage(
    cursor: Extract<CaltonCursor, { phase: "models" | "ready" }>,
  ): CaltonResult<void> {
    return caltonBoundary("model badge coverage", () => {
      if (cursor.phase !== "ready")
        throw new Error("Only a ready graph is checked for badge coverage");
      const published = caltonModels(cursor.menus);
      const shortfall = ModelCensus.coverage(
        "Calton",
        {
          controls: censusControls(cursor.menus),
          pages: cursor.pages,
          previous: cursor.previous,
          cards: caltonCards,
        },
        CALTON_MINIMUM_BADGE_COVERAGE,
        (index) => published[index]?.model.path ?? "?",
      );
      if (shortfall) throw new Error(shortfall);
    });
  },
  fromWire(raw: string, contract: CaltonContract) {
    return caltonBoundary("checkpoint wire", () => {
      if (Buffer.byteLength(raw) > CALTON_MAX_CURSOR_BYTES)
        throw new Error("Checkpoint wire exceeds 64 MiB");
      return validate(JSON.parse(raw), contract);
    });
  },
  serialize(cursor: CaltonCursor, contract: CaltonContract) {
    return caltonBoundary("checkpoint serialization", () =>
      JSON.stringify(validate(cursor, contract)),
    );
  },
  checkpoint(input: unknown, contract: CaltonContract) {
    return caltonBoundary("checkpoint transition", () =>
      checkpoint(input, contract),
    );
  },
} as const;
