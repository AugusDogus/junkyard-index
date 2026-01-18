import { eq } from "drizzle-orm";
import * as schema from "~/schema";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const userRouter = createTRPCRouter({
  deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
    // Delete the user - cascade delete will handle sessions, accounts, and saved searches
    await ctx.db.delete(schema.user).where(eq(schema.user.id, ctx.user.id));

    return { success: true };
  }),
});
