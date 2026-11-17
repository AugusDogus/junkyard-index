import { z } from "zod";
import type { SpartanKind } from "./spartan-yard-metadata";

// Only public donor fields enter checkpoints. Description and feed extras do not.
export const SpartanDonorSchema = z.object({
  id: z.number().int().positive(),
  type: z.enum(["auto", "truck"]),
  stock: z
    .string()
    .max(100)
    .nullish()
    .transform((value) => value ?? ""),
  vin: z.string().max(100),
  year: z.number().int().min(1886).max(2100),
  make: z.string().max(100),
  model: z.string().max(300),
  color: z.string().max(200).nullable().default(null),
  imageUrl: z
    .string()
    .regex(
      /^https:\/\/api\.spartanauto\.parts\/storage\/vehicles\/[a-zA-Z0-9_.-]+$/,
    )
    .nullable()
    .default(null),
});
export type SpartanDonor = z.infer<typeof SpartanDonorSchema>;
export const SpartanPageSchema = z
  .object({
    kind: z.enum(["auto", "truck"]),
    page: z.number().int().min(1).max(200),
    last: z.number().int().min(1).max(200),
    total: z.number().int().positive().max(2400),
    rows: z.array(SpartanDonorSchema).min(1).max(12),
  })
  .strict();
export type SpartanPage = z.infer<typeof SpartanPageSchema>;

export const SpartanPage = {
  parse(raw: string, kind: SpartanKind, page: number): SpartanPage {
    const data = z
      .object({
        data: z
          .array(
            SpartanDonorSchema.omit({ imageUrl: true }).extend({
              images: z
                .array(
                  z.string().regex(/^\/storage\/vehicles\/[a-zA-Z0-9_.-]+$/),
                )
                .max(256)
                .nullish()
                .transform((images) => images ?? []),
            }),
          )
          .min(1)
          .max(12),
        meta: z.object({
          current_page: z.literal(page),
          last_page: z.number().int().min(1).max(200),
          per_page: z.literal(12),
          from: z.number().int(),
          to: z.number().int(),
          total: z.number().int().positive().max(2400),
        }),
      })
      .parse(JSON.parse(raw));
    const m = data.meta;
    if (
      m.last_page !== Math.ceil(m.total / 12) ||
      page > m.last_page ||
      m.from !== (page - 1) * 12 + 1 ||
      m.to !== Math.min(page * 12, m.total) ||
      data.data.length !== m.to - m.from + 1 ||
      data.data.some((row) => row.type !== kind)
    )
      throw new Error(
        `Spartan ${kind} page ${page} has incomplete or foreign membership; restart the complete census.`,
      );
    return SpartanPageSchema.parse({
      kind,
      page,
      last: m.last_page,
      total: m.total,
      rows: data.data.map(({ images, ...row }) => ({
        ...row,
        imageUrl: images[0]
          ? "https://api.spartanauto.parts" + images[0]
          : null,
      })),
    });
  },
} as const;
