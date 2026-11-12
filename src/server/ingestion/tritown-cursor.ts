import { z } from "zod";
import { inventoryVin } from "./inventory-vin";
import { TRITOWN_MAX_PAGES, TRITOWN_PAGE_SIZE } from "./tritown-parser";
import { TRITOWN_ORIGIN } from "./tritown-yard-metadata";

const count = z
  .number()
  .int()
  .nonnegative()
  .max(TRITOWN_MAX_PAGES * TRITOWN_PAGE_SIZE);
export const TritownCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({ source: z.literal("tritown"), phase: z.literal("start") })
      .strict(),
    z
      .object({
        source: z.literal("tritown"),
        phase: z.literal("pages"),
        nextPage: z.number().int().min(2).max(TRITOWN_MAX_PAGES),
        lastPage: z.number().int().min(2).max(TRITOWN_MAX_PAGES),
        processed: count,
        emitted: count,
        rejected: count,
        makes: z.array(z.string().min(1).max(100)).min(1).max(100),
        vins: z
          .array(z.string().min(5).max(17))
          .max(TRITOWN_MAX_PAGES * TRITOWN_PAGE_SIZE),
        urls: z
          .array(
            z
              .string()
              .startsWith(TRITOWN_ORIGIN + "/vehicle/")
              .max(1_000),
          )
          .max(TRITOWN_MAX_PAGES * TRITOWN_PAGE_SIZE),
        hashes: z
          .array(z.string().regex(/^[a-f0-9]{64}$/))
          .max(TRITOWN_MAX_PAGES),
      })
      .strict(),
    z
      .object({ source: z.literal("tritown"), phase: z.literal("complete") })
      .strict(),
  ])
  .superRefine((cursor, context) => {
    if (cursor.phase !== "pages") return;
    const unique = (values: readonly string[]) =>
      new Set(values).size === values.length;
    if (
      cursor.nextPage > cursor.lastPage ||
      cursor.processed !== (cursor.nextPage - 1) * TRITOWN_PAGE_SIZE ||
      cursor.processed !== cursor.emitted + cursor.rejected ||
      cursor.urls.length !== cursor.processed ||
      cursor.hashes.length !== cursor.nextPage - 1 ||
      cursor.vins.length < cursor.emitted ||
      cursor.vins.length > cursor.processed ||
      !unique(cursor.makes) ||
      !unique(cursor.vins) ||
      !unique(cursor.urls) ||
      !unique(cursor.hashes) ||
      cursor.vins.some(
        (vin) => inventoryVin(vin, vin.length === 17 ? "1981" : "1980") !== vin,
      ) ||
      cursor.urls.some((raw) => {
        const url = URL.parse(raw);
        return (
          !url ||
          url.origin !== TRITOWN_ORIGIN ||
          url.search ||
          url.hash ||
          !/^\/vehicle\/[a-z0-9_-]+\/$/.test(url.pathname)
        );
      })
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "TriTown checkpoint page coverage, identities or accounting is inconsistent; retain the last validated checkpoint",
      });
  });
export type TritownCursor = z.infer<typeof TritownCursorSchema>;
export const TritownCursor = {
  initial: { source: "tritown", phase: "start" },
} as const satisfies { initial: TritownCursor };
