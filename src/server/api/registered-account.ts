import { TRPCError } from "@trpc/server";
import { isGuestSession } from "~/lib/session-user";

type AccountLike = { isAnonymous?: boolean | null };

export function requireRegisteredAccount<T extends AccountLike>(
  user: T | null | undefined,
): asserts user is T {
  if (!user || isGuestSession(user)) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in to a registered account to manage billing.",
    });
  }
}
