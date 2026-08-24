import { and, eq, inArray, sql } from "drizzle-orm";
import { type LibSQLDatabase } from "drizzle-orm/libsql";
import { billingOperation, user } from "~/schema";

export type ActiveBillingOperation = "checkout" | "deleting";

export type BillingOperationClaim =
  | {
      status: "claimed";
      operation: ActiveBillingOperation;
      token: string;
      expiresAt: Date;
    }
  | {
      status: "busy";
      operation: ActiveBillingOperation;
      expiresAt: Date;
    }
  | { status: "missing" };

export const BILLING_OPERATION_LEASE_MS = 30 * 60 * 1000;
export const UNCERTAIN_CHECKOUT_HOLD_MS = 15 * 60 * 1000;

type ClaimBillingOperationParams = {
  database: LibSQLDatabase;
  userId: string;
  operation: ActiveBillingOperation;
  token: string;
  now: Date;
  leaseMs?: number;
  reusableState?: "checkout_open" | "checkout_completed";
};

async function claimBillingOperation(
  params: ClaimBillingOperationParams,
): Promise<BillingOperationClaim> {
  const expiresAt = new Date(
    params.now.getTime() + (params.leaseMs ?? BILLING_OPERATION_LEASE_MS),
  );
  const targetState =
    params.operation === "checkout" ? "checkout_claimed" : "deleting";
  const reusableStateCondition = params.reusableState
    ? sql`or billing_operation.state = ${params.reusableState}`
    : sql``;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const claimed = await params.database.run(sql`
      insert into billing_operation (user_id, state, token, expires_at)
      select ${params.userId}, ${targetState}, ${params.token}, ${expiresAt.getTime()}
      from user
      where id = ${params.userId}
      on conflict(user_id) do update set
        state = excluded.state,
        token = excluded.token,
        expires_at = excluded.expires_at
      where billing_operation.expires_at <= ${params.now.getTime()}
        ${reusableStateCondition}
    `);

    if (claimed.rowsAffected === 1) {
      return {
        status: "claimed",
        operation: params.operation,
        token: params.token,
        expiresAt,
      };
    }

    const [currentUser] = await params.database
      .select({
        id: user.id,
        state: billingOperation.state,
        expiresAt: billingOperation.expiresAt,
      })
      .from(user)
      .leftJoin(billingOperation, eq(billingOperation.userId, user.id))
      .where(eq(user.id, params.userId))
      .limit(1);

    if (!currentUser) return { status: "missing" };
    if (!currentUser.state || !currentUser.expiresAt) continue;

    return {
      status: "busy",
      operation: currentUser.state === "deleting" ? "deleting" : "checkout",
      expiresAt: currentUser.expiresAt,
    };
  }

  throw new Error(
    `Billing operation for user ${params.userId} changed during three consecutive claim attempts.`,
  );
}

export function claimCheckoutBillingOperation(
  params: Omit<ClaimBillingOperationParams, "operation" | "reusableState">,
): Promise<BillingOperationClaim> {
  return claimBillingOperation({
    ...params,
    operation: "checkout",
    reusableState: "checkout_open",
  });
}

export function claimDeletionBillingOperation(
  params: Omit<ClaimBillingOperationParams, "operation" | "reusableState">,
): Promise<BillingOperationClaim> {
  return claimBillingOperation({
    ...params,
    operation: "deleting",
    reusableState: "checkout_completed",
  });
}

export async function completeBillingOperationClaim(params: {
  database: LibSQLDatabase;
  userId: string;
  operation: ActiveBillingOperation;
  token: string;
  next: { operation: "idle" } | { operation: "checkout"; expiresAt: Date };
}): Promise<boolean> {
  const expectedState =
    params.operation === "checkout" ? "checkout_claimed" : "deleting";
  if (params.next.operation === "idle") {
    const expectedStates =
      params.operation === "checkout"
        ? (["checkout_claimed", "checkout_completed_claimed"] as const)
        : (["deleting"] as const);
    const completed = await params.database
      .delete(billingOperation)
      .where(
        and(
          eq(billingOperation.userId, params.userId),
          inArray(billingOperation.state, expectedStates),
          eq(billingOperation.token, params.token),
        ),
      );
    return completed.rowsAffected === 1;
  }

  const completed = await params.database
    .update(billingOperation)
    .set({
      state: "checkout_open",
      token: null,
      expiresAt: params.next.expiresAt,
    })
    .where(
      and(
        eq(billingOperation.userId, params.userId),
        eq(billingOperation.state, expectedState),
        eq(billingOperation.token, params.token),
      ),
    );
  if (completed.rowsAffected === 1) return true;

  if (params.operation !== "checkout") return false;
  const acknowledged = await params.database
    .delete(billingOperation)
    .where(
      and(
        eq(billingOperation.userId, params.userId),
        eq(billingOperation.state, "checkout_completed_claimed"),
        eq(billingOperation.token, params.token),
      ),
    );
  return acknowledged.rowsAffected === 1;
}

export async function recordCheckoutCompletion(params: {
  database: LibSQLDatabase;
  userId: string;
}): Promise<void> {
  await params.database
    .update(billingOperation)
    .set({
      state: sql`case
        when ${billingOperation.state} = 'checkout_claimed'
          then 'checkout_completed_claimed'
        else 'checkout_completed'
      end`,
    })
    .where(
      and(
        eq(billingOperation.userId, params.userId),
        inArray(billingOperation.state, ["checkout_claimed", "checkout_open"]),
      ),
    );
}
