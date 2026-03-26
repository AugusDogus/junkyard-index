import { savedSearchesRouter } from "~/server/api/routers/savedSearches";
import { statsRouter } from "~/server/api/routers/stats";
import { statusRouter } from "~/server/api/routers/status";
import { subscriptionRouter } from "~/server/api/routers/subscription";
import { userRouter } from "~/server/api/routers/user";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  savedSearches: savedSearchesRouter,
  subscription: subscriptionRouter,
  user: userRouter,
  stats: statsRouter,
  status: statusRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);
