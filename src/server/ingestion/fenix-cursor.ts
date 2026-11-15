import { z } from "zod";
import { FenixDonor } from "./fenix-donor";
import { validateFenixYardEvidence } from "./fenix-evidence";
import { fenixPhotoUrl } from "./fenix-photo";
import {
  FenixDetailIdSchema,
  FenixRecordSchema,
  fenixHash,
} from "./fenix-parser";
import { FENIX_YARD_CODES, FENIX_YARDS } from "./fenix-yard-metadata";

const yard = z.enum(FENIX_YARD_CODES);
const order = z.enum(["DESC", "ASC"]);
const entry = z.object({ yard, record: FenixRecordSchema }).strict();
const page = z
  .object({
    yard,
    order,
    page: z.number().int().min(1).max(999),
    lastPage: z.number().int().min(1).max(999),
    ids: z.array(FenixDetailIdSchema).min(1).max(50),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const evidence = {
  source: z.literal("fenix"),
  entries: z.array(entry).max(30_000),
  pages: z.array(page).max(6000),
  verified: z.array(yard).max(FENIX_YARD_CODES.length),
  checks: z
    .array(
      z
        .object({
          yard,
          order,
          page: z.number().int().min(1).max(999),
          hash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    )
    .max(4 * FENIX_YARD_CODES.length),
};
export type FenixEntry = z.infer<typeof entry>;
export type FenixPageEvidence = z.infer<typeof page>;

export const FenixCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({ source: z.literal("fenix"), phase: z.literal("start") })
      .strict(),
    z
      .object({
        ...evidence,
        phase: z.literal("inventory"),
        yardIndex: z
          .number()
          .int()
          .min(0)
          .max(FENIX_YARD_CODES.length - 1),
        order,
        page: z.number().int().min(1).max(999),
      })
      .strict(),
    z
      .object({
        ...evidence,
        phase: z.literal("verify"),
        yardIndex: z
          .number()
          .int()
          .min(0)
          .max(FENIX_YARD_CODES.length - 1),
        controlIndex: z.number().int().min(0).max(3),
      })
      .strict(),
    z.object({ ...evidence, phase: z.literal("complete") }).strict(),
  ])
  .superRefine((cursor, context) => {
    if (cursor.phase === "start") return;
    const owners = new Map(
      cursor.entries.map((value) => [value.record.id, value]),
    );
    const vins = cursor.entries.flatMap((value) => {
      const result = FenixDonor.parse(value.record);
      const vin = result.status === "available" ? result.donor.vin : result.vin;
      return vin ? [vin] : [];
    });
    const referenced = new Set(cursor.pages.flatMap((value) => value.ids));
    const completeYards =
      cursor.phase === "complete" ? FENIX_YARD_CODES.length : cursor.yardIndex;
    let valid =
      owners.size === cursor.entries.length &&
      new Set(vins).size === vins.length &&
      referenced.size === owners.size &&
      [...owners.keys()].every((id) => referenced.has(id)) &&
      JSON.stringify(cursor.verified) ===
        JSON.stringify(FENIX_YARD_CODES.slice(0, completeYards));
    valid &&= cursor.entries.every(
      (value) =>
        value.record.location ===
          `${FENIX_YARDS[value.yard].city}, ${FENIX_YARDS[value.yard].state}` &&
        ((!/^[1-9]\d{8}$/.test(value.record.stock) &&
          !value.record.id.startsWith("STK")) ||
          value.record.stock === value.record.id) &&
        (value.record.photoUrl === null ||
          fenixPhotoUrl(value.record.photoUrl, value.record.id) ===
            value.record.photoUrl),
    );
    let offset = 0;
    for (let index = 0; index < FENIX_YARD_CODES.length; index++) {
      const code = FENIX_YARD_CODES[index];
      if (!code) {
        valid = false;
        break;
      }
      for (const direction of ["DESC", "ASC"] as const) {
        const pages = cursor.pages.filter(
          (value) => value.yard === code && value.order === direction,
        );
        const last = pages[0]?.lastPage;
        valid &&= pages.every((value, i) => {
          const records = value.ids.map((id) => owners.get(id));
          return (
            cursor.pages[offset + i] === value &&
            value.page === i + 1 &&
            value.lastPage === last &&
            value.page <= value.lastPage &&
            (value.page === value.lastPage || value.ids.length === 50) &&
            records.every((record) => record?.yard === code) &&
            fenixHash(records.map((record) => record?.record)) === value.hash
          );
        });
        offset += pages.length;
        if (
          index < completeYards ||
          (cursor.phase === "verify" && index === cursor.yardIndex)
        )
          valid &&= last !== undefined && pages.length === last;
        else if (cursor.phase === "inventory" && index === cursor.yardIndex) {
          if (cursor.order === "ASC" && direction === "DESC")
            valid &&= last !== undefined && pages.length === last;
          else if (cursor.order === direction)
            valid &&=
              pages.length === cursor.page - 1 &&
              (last === undefined || cursor.page <= last);
          else valid &&= pages.length === 0;
        } else valid &&= pages.length === 0;
      }
    }
    valid &&= offset === cursor.pages.length;
    const expectedChecks =
      completeYards * 4 + (cursor.phase === "verify" ? cursor.controlIndex : 0);
    valid &&=
      cursor.checks.length === expectedChecks &&
      cursor.checks.every((check, index) => {
        const code = FENIX_YARD_CODES[Math.floor(index / 4)];
        const direction = index % 4 < 2 ? "DESC" : "ASC";
        const pages = cursor.pages.filter(
          (page) => page.yard === code && page.order === direction,
        );
        const control = index % 2 === 0 ? pages[0] : pages.at(-1);
        return (
          control !== undefined &&
          check.yard === code &&
          check.order === direction &&
          check.page === control.page &&
          check.hash === control.hash
        );
      });
    if (valid) {
      try {
        for (let index = 0; index < completeYards; index++) {
          const code = FENIX_YARD_CODES[index];
          if (code)
            validateFenixYardEvidence(cursor.entries, cursor.pages, code);
        }
      } catch (cause) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            cause instanceof Error
              ? cause.message
              : "Fenix completed-yard quality or completeness evidence is invalid",
        });
      }
    }
    if (!valid)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Fenix checkpoint pagination, ownership or row fingerprints are inconsistent; restart from the last validated checkpoint",
      });
  });
export type FenixCursor = z.infer<typeof FenixCursorSchema>;
export const FenixCursor = {
  initial: { source: "fenix", phase: "start" },
} as const satisfies { initial: FenixCursor };
