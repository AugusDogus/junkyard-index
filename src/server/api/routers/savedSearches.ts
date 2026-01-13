import { eq } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { savedSearch } from "../../../../schema";

const filtersSchema = z.object({
  makes: z.array(z.string()).optional(),
  colors: z.array(z.string()).optional(),
  states: z.array(z.string()).optional(),
  salvageYards: z.array(z.string()).optional(),
  minYear: z.number().optional(),
  maxYear: z.number().optional(),
  sortBy: z.string().optional(),
});

export const savedSearchesRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const searches = await ctx.db
      .select()
      .from(savedSearch)
      .where(eq(savedSearch.userId, ctx.user.id))
      .orderBy(savedSearch.createdAt);

    return searches.map((s) => ({
      ...s,
      filters: JSON.parse(s.filters) as z.infer<typeof filtersSchema>,
    }));
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        query: z.string(),
        filters: filtersSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = crypto.randomUUID();
      const now = new Date();

      await ctx.db.insert(savedSearch).values({
        id,
        userId: ctx.user.id,
        name: input.name,
        query: input.query,
        filters: JSON.stringify(input.filters),
        createdAt: now,
        updatedAt: now,
      });

      return { id };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(savedSearch)
        .where(
          eq(savedSearch.id, input.id) &&
            eq(savedSearch.userId, ctx.user.id),
        );

      return { success: true };
    }),
});
