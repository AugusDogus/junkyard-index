import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  checkRateLimit,
  getClientIp,
  yardRequestLimiter,
} from "~/lib/rate-limit";
import { yardRequestWebsiteSchema } from "~/lib/yard-request-website";
import posthog from "~/lib/posthog-server";
import { sendYardRequestNotification } from "~/lib/email";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { yardRequest } from "~/schema";

export const yardRequestsRouter = createTRPCRouter({
  create: publicProcedure
    .input(
      z.object({
        yardName: z.string().trim().min(2).max(200),
        website: yardRequestWebsiteSchema.optional(),
        requesterEmail: z.string().trim().email().max(320).optional(),
        // Analytics-only: joins the server event with the visitor's client
        // PostHog session. Clients can spoof it and misattribute an event to
        // another identity; accepted tradeoff (no auth/data impact).
        clientDistinctId: z.string().trim().min(8).max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const allowed = await checkRateLimit(
        yardRequestLimiter,
        getClientIp(ctx.headers),
      );
      if (!allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message:
            "You've submitted several requests recently. Please try again later.",
        });
      }

      const id = crypto.randomUUID();

      await ctx.db.insert(yardRequest).values({
        id,
        userId: ctx.user?.id ?? null,
        yardName: input.yardName,
        website: input.website ?? null,
        requesterEmail: input.requesterEmail ?? null,
      });

      // Fire-and-forget, matching the other server-side captures in this repo
      // (savedSearches, user); events can be lost if the lambda freezes early.
      posthog.capture({
        // Prefer the authenticated id; otherwise reuse the browser SDK's
        // distinct id so the event joins the visitor's client-side session.
        // Last resort is an opaque per-request id (never the raw IP).
        distinctId: ctx.user?.id ?? input.clientDistinctId ?? id,
        event: AnalyticsEvents.YARD_REQUEST_SUBMITTED,
        properties: {
          request_id: id,
          is_logged_in: Boolean(ctx.user),
          has_website: Boolean(input.website),
          has_email: Boolean(input.requesterEmail),
        },
      });

      // The helper is infallible: failures are logged and reported to Sentry
      // there, and the request is already saved. The NotificationDeliveryResult
      // return mirrors sendEmailDigest; nothing here needs to consume it.
      await sendYardRequestNotification({
        yardName: input.yardName,
        website: input.website ?? null,
        followUpEmail: input.requesterEmail ?? null,
      });

      return { id };
    }),
});
