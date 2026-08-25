import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { TERMS_METADATA } from "~/lib/legal";
import { BILLING_INTERVALS, PAID_PLAN_TIERS } from "~/lib/plans";
import posthog from "~/lib/posthog-server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { polarBillingGateway } from "~/server/polar-billing-gateway";
import { getBillingProductKey } from "~/server/billing/product-catalog";
import {
  createSubscriptionCheckout,
  type SubscriptionCheckoutBlocked,
} from "~/server/subscription-checkout";
import { rememberPlanTierFromSnapshot } from "~/server/billing/user-plan";

function checkoutBlockedMessage(result: SubscriptionCheckoutBlocked): string {
  switch (result.reason) {
    case "account_missing":
      return "This account no longer exists. Sign out before creating another account.";
    case "account_changed":
      return "Your account changed while checkout was being prepared. Refresh before trying again.";
    case "deletion_in_progress":
      return `Account deletion is already in progress, so checkout cannot be started. Retry after ${result.retryAt.toISOString()}.`;
    case "checkout_in_progress":
      return `Checkout is already being prepared for this account. Retry after ${result.retryAt.toISOString()}.`;
    case "already_subscribed":
      return "This account already has a subscription that can renew or recover payment. Manage that subscription instead of starting another checkout.";
    case "checkout_pending":
      return `A checkout is already being processed for this account. Retry after ${result.retryAt.toISOString()}.`;
    case "state_changed":
      return "Billing state changed while checkout was being prepared. Refresh your account before trying again.";
  }
}

const paidTierSchema = z.enum(PAID_PLAN_TIERS);
const billingIntervalSchema = z.enum(BILLING_INTERVALS);

export const subscriptionRouter = createTRPCRouter({
  createCheckout: protectedProcedure
    .input(
      z.object({
        termsVersion: z.literal(TERMS_METADATA.version),
        tier: paidTierSchema,
        interval: billingIntervalSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const result = await createSubscriptionCheckout({
        database: ctx.db,
        billing: polarBillingGateway,
        productKey: getBillingProductKey(input.tier, input.interval),
        userId: ctx.user.id,
        termsVersion: TERMS_METADATA.version,
        termsAcceptedAt: new Date(),
        now,
        claimToken: randomUUID(),
      });

      if (result.status === "blocked") {
        throw new TRPCError({
          code: "CONFLICT",
          message: checkoutBlockedMessage(result),
        });
      }

      if (result.status === "failed") {
        const message =
          result.reason === "checkout_creation_uncertain"
            ? `Checkout creation could not be confirmed. To avoid a duplicate charge, retry after ${result.retryAt.toISOString()}.`
            : "Checkout could not be started. No checkout was created, and your saved searches are unchanged. Please try again.";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
          cause: result.cause,
        });
      }

      posthog.capture({
        distinctId: ctx.user.id,
        event: AnalyticsEvents.CHECKOUT_INITIATED,
        properties: {
          source: "subscription_confirmation",
          reused: result.reused,
        },
      });

      return { url: result.url };
    }),

  getAccountOverview: protectedProcedure.query(async ({ ctx }) => {
    try {
      const overview = await polarBillingGateway.getAccountOverview(
        ctx.user.id,
      );
      if (overview.kind === "active") {
        rememberPlanTierFromSnapshot(ctx.user.id, overview.tier);
      } else if (
        overview.kind === "none" ||
        overview.kind === "needs_attention"
      ) {
        rememberPlanTierFromSnapshot(ctx.user.id, "free");
      }
      return overview;
    } catch (cause) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Subscription status could not be verified. Please try again.",
        cause,
      });
    }
  }),
});
