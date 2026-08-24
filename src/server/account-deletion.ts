import { type LibSQLDatabase } from "drizzle-orm/libsql";
import {
  claimDeletionBillingOperation,
  completeBillingOperationClaim,
} from "~/server/billing-operation";
import {
  type AccountDeletionBilling,
  type BillingCheckout,
  BillingSubscription,
  type BillingSubscription as BillingSubscriptionRecord,
} from "~/server/billing";

type AccountDeletionBlockedContext = {
  status: "blocked";
  revokedSubscriptionIds: readonly string[];
  failedSubscriptionIds: readonly string[];
  message: string;
};

export type AccountDeletionBlocked = AccountDeletionBlockedContext &
  (
    | { reason: "account_missing" | "state_changed" }
    | {
        reason: "checkout_in_progress" | "deletion_in_progress";
        retryAt: Date;
      }
    | { reason: "billing_lookup_failed"; cause: unknown }
    | { reason: "open_checkout"; retryAt: Date }
    | { reason: "subscription_revocation_failed"; cause: unknown }
    | { reason: "local_deletion_failed"; cause: unknown }
  );

export type AccountDeletionResult =
  | { status: "deleted"; revokedSubscriptionIds: readonly string[] }
  | AccountDeletionBlocked;

export type AccountDeletionDependencies = {
  database: LibSQLDatabase;
  billing: AccountDeletionBilling;
  userId: string;
  now: Date;
  claimToken: string;
  deleteLocalAccount(userId: string): Promise<void>;
};

type ClaimedDeletionFailure = Omit<AccountDeletionBlockedContext, "status"> &
  (
    | { reason: "billing_lookup_failed"; cause: unknown }
    | { reason: "open_checkout"; retryAt: Date }
    | { reason: "subscription_revocation_failed"; cause: unknown }
    | { reason: "local_deletion_failed"; cause: unknown }
  );

async function releaseFailedDeletion(
  input: AccountDeletionDependencies,
  failure: ClaimedDeletionFailure,
): Promise<AccountDeletionResult> {
  const completed = await completeBillingOperationClaim({
    database: input.database,
    userId: input.userId,
    operation: "deleting",
    token: input.claimToken,
    next:
      failure.reason === "open_checkout"
        ? {
            operation: "checkout",
            expiresAt: failure.retryAt,
          }
        : { operation: "idle" },
  });

  return completed
    ? { status: "blocked", ...failure }
    : {
        status: "blocked",
        reason: "state_changed",
        revokedSubscriptionIds: failure.revokedSubscriptionIds,
        failedSubscriptionIds: failure.failedSubscriptionIds,
        message:
          "Account billing state changed while deletion was being prepared. Your account and data were preserved.",
      };
}

export async function deleteAccountSafely(
  input: AccountDeletionDependencies,
): Promise<AccountDeletionResult> {
  const claim = await claimDeletionBillingOperation({
    database: input.database,
    userId: input.userId,
    token: input.claimToken,
    now: input.now,
  });

  if (claim.status === "missing") {
    return {
      status: "blocked",
      reason: "account_missing",
      revokedSubscriptionIds: [],
      failedSubscriptionIds: [],
      message: "This account has already been deleted.",
    };
  }

  if (claim.status === "busy") {
    const retryMessage = ` Retry after ${claim.expiresAt.toISOString()}.`;
    return {
      status: "blocked",
      reason:
        claim.operation === "checkout"
          ? "checkout_in_progress"
          : "deletion_in_progress",
      revokedSubscriptionIds: [],
      failedSubscriptionIds: [],
      retryAt: claim.expiresAt,
      message:
        claim.operation === "checkout"
          ? `Checkout is open or being prepared, so account deletion cannot start.${retryMessage}`
          : `Account deletion is already in progress.${retryMessage}`,
    };
  }

  let subscriptions: readonly BillingSubscriptionRecord[];
  let openCheckouts: readonly BillingCheckout[];

  try {
    [subscriptions, openCheckouts] = await Promise.all([
      input.billing.listSubscriptions(input.userId),
      input.billing.listOutstandingCheckouts(input.userId),
    ]);
  } catch (cause) {
    return releaseFailedDeletion(input, {
      reason: "billing_lookup_failed",
      revokedSubscriptionIds: [],
      failedSubscriptionIds: [],
      message:
        "We could not verify your billing status, so your account and data were preserved. Retry after billing services recover.",
      cause,
    });
  }

  if (openCheckouts.length > 0) {
    const nextExpiration = openCheckouts.reduce(
      (earliest, checkout) =>
        checkout.expiresAt < earliest ? checkout.expiresAt : earliest,
      openCheckouts[0]?.expiresAt ?? input.now,
    );

    return releaseFailedDeletion(input, {
      reason: "open_checkout",
      revokedSubscriptionIds: [],
      failedSubscriptionIds: [],
      message: `An unfinished checkout is still open. Complete it or retry account deletion after it expires at ${nextExpiration.toISOString()}. Your account and data were preserved.`,
      retryAt: nextExpiration,
    });
  }

  const subscriptionsToRevoke = subscriptions.filter(
    BillingSubscription.canProduceFutureCharge,
  );
  const revocations = await Promise.all(
    subscriptionsToRevoke.map(async ({ id }) => {
      try {
        await input.billing.revokeSubscription(id);
        return { status: "revoked", id } as const;
      } catch (cause) {
        return { status: "failed", id, cause } as const;
      }
    }),
  );
  const revokedSubscriptionIds = revocations
    .filter((result) => result.status === "revoked")
    .map(({ id }) => id);
  const failedRevocations = revocations.filter(
    (result) => result.status === "failed",
  );

  if (failedRevocations.length > 0) {
    return releaseFailedDeletion(input, {
      reason: "subscription_revocation_failed",
      revokedSubscriptionIds,
      failedSubscriptionIds: failedRevocations.map(({ id }) => id),
      message:
        "We could not stop every charge-capable subscription, so your account and data were preserved. Some subscriptions were already revoked. Review Manage Subscription, then retry account deletion.",
      cause: failedRevocations[0]?.cause,
    });
  }

  try {
    await input.deleteLocalAccount(input.userId);
  } catch (cause) {
    return releaseFailedDeletion(input, {
      reason: "local_deletion_failed",
      revokedSubscriptionIds,
      failedSubscriptionIds: [],
      message:
        "Your subscriptions were stopped, but your local account could not be deleted. Your account data was preserved. Retry account deletion or contact support.",
      cause,
    });
  }

  return { status: "deleted", revokedSubscriptionIds };
}
