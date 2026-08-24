import { eq } from "drizzle-orm";
import { type LibSQLDatabase } from "drizzle-orm/libsql";
import { user } from "~/schema";
import {
  claimCheckoutBillingOperation,
  completeBillingOperationClaim,
  UNCERTAIN_CHECKOUT_HOLD_MS,
} from "~/server/billing-operation";
import {
  BillingCheckout,
  type BillingCheckout as BillingCheckoutRecord,
  BillingSubscription,
  type BillingSubscription as BillingSubscriptionRecord,
  type SubscriptionCheckoutBilling,
} from "~/server/billing";

export type SubscriptionCheckoutBlocked =
  | {
      status: "blocked";
      reason:
        | "account_missing"
        | "account_changed"
        | "already_subscribed"
        | "state_changed";
    }
  | {
      status: "blocked";
      reason:
        | "deletion_in_progress"
        | "checkout_in_progress"
        | "checkout_pending";
      retryAt: Date;
    };

export type SubscriptionCheckoutResult =
  | { status: "ready"; url: string; reused: boolean }
  | SubscriptionCheckoutBlocked
  | {
      status: "failed";
      reason: "terms_record_failed" | "billing_lookup_failed";
      cause: unknown;
    }
  | {
      status: "failed";
      reason: "checkout_creation_uncertain";
      cause: unknown;
      retryAt: Date;
    };

export async function createSubscriptionCheckout(input: {
  database: LibSQLDatabase;
  billing: SubscriptionCheckoutBilling;
  userId: string;
  termsVersion: string;
  termsAcceptedAt: Date;
  now: Date;
  claimToken: string;
}): Promise<SubscriptionCheckoutResult> {
  const claim = await claimCheckoutBillingOperation({
    database: input.database,
    userId: input.userId,
    token: input.claimToken,
    now: input.now,
  });

  if (claim.status === "missing") {
    return { status: "blocked", reason: "account_missing" };
  }
  if (claim.status === "busy") {
    return {
      status: "blocked",
      reason:
        claim.operation === "deleting"
          ? "deletion_in_progress"
          : "checkout_in_progress",
      retryAt: claim.expiresAt,
    };
  }

  const finishClaim = (
    next: { operation: "idle" } | { operation: "checkout"; expiresAt: Date },
  ) =>
    completeBillingOperationClaim({
      database: input.database,
      userId: input.userId,
      operation: "checkout",
      token: input.claimToken,
      next,
    });

  try {
    const acceptance = await input.database
      .update(user)
      .set({
        termsAcceptedAt: input.termsAcceptedAt,
        termsVersion: input.termsVersion,
      })
      .where(eq(user.id, input.userId));

    if (acceptance.rowsAffected !== 1) {
      return (await finishClaim({ operation: "idle" }))
        ? { status: "blocked", reason: "account_changed" }
        : { status: "blocked", reason: "state_changed" };
    }
  } catch (cause) {
    if (!(await finishClaim({ operation: "idle" }))) {
      return { status: "blocked", reason: "state_changed" };
    }
    return { status: "failed", reason: "terms_record_failed", cause };
  }

  let subscriptions: readonly BillingSubscriptionRecord[];
  try {
    subscriptions = await input.billing.listSubscriptions(input.userId);
  } catch (cause) {
    if (!(await finishClaim({ operation: "idle" }))) {
      return { status: "blocked", reason: "state_changed" };
    }
    return { status: "failed", reason: "billing_lookup_failed", cause };
  }

  if (subscriptions.some(BillingSubscription.canProduceFutureCharge)) {
    return (await finishClaim({ operation: "idle" }))
      ? { status: "blocked", reason: "already_subscribed" }
      : { status: "blocked", reason: "state_changed" };
  }

  let outstandingCheckouts: readonly BillingCheckoutRecord[];
  try {
    outstandingCheckouts = await input.billing.listOutstandingCheckouts(
      input.userId,
    );
  } catch (cause) {
    if (!(await finishClaim({ operation: "idle" }))) {
      return { status: "blocked", reason: "state_changed" };
    }
    return { status: "failed", reason: "billing_lookup_failed", cause };
  }

  const pendingCheckout = outstandingCheckouts.find(
    BillingCheckout.isConfirmationPending,
  );
  if (pendingCheckout) {
    return (await finishClaim({
      operation: "checkout",
      expiresAt: pendingCheckout.expiresAt,
    }))
      ? {
          status: "blocked",
          reason: "checkout_pending",
          retryAt: pendingCheckout.expiresAt,
        }
      : { status: "blocked", reason: "state_changed" };
  }

  const reusableCheckout = outstandingCheckouts.find(
    BillingCheckout.isReusable,
  );
  if (reusableCheckout) {
    if (
      !(await finishClaim({
        operation: "checkout",
        expiresAt: reusableCheckout.expiresAt,
      }))
    ) {
      return { status: "blocked", reason: "state_changed" };
    }
    return { status: "ready", url: reusableCheckout.url, reused: true };
  }

  let checkout: BillingCheckoutRecord;
  try {
    checkout = await input.billing.createCheckout({
      userId: input.userId,
      termsVersion: input.termsVersion,
      termsAcceptedAt: input.termsAcceptedAt,
    });
  } catch (cause) {
    const retryAt = new Date(input.now.getTime() + UNCERTAIN_CHECKOUT_HOLD_MS);
    const finished = await finishClaim({
      operation: "checkout",
      expiresAt: retryAt,
    });
    return finished
      ? {
          status: "failed",
          reason: "checkout_creation_uncertain",
          cause,
          retryAt,
        }
      : { status: "blocked", reason: "state_changed" };
  }

  if (checkout.state === "confirmation_pending") {
    return (await finishClaim({
      operation: "checkout",
      expiresAt: checkout.expiresAt,
    }))
      ? {
          status: "blocked",
          reason: "checkout_pending",
          retryAt: checkout.expiresAt,
        }
      : { status: "blocked", reason: "state_changed" };
  }

  if (
    !(await finishClaim({
      operation: "checkout",
      expiresAt: checkout.expiresAt,
    }))
  ) {
    return { status: "blocked", reason: "state_changed" };
  }

  return { status: "ready", url: checkout.url, reused: false };
}
