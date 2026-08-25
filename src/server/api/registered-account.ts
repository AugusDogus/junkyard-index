import { TRPCError } from "@trpc/server";
import {
  isRegisteredSessionUser,
  type RegisteredSessionUser,
  type SessionUserLike,
} from "~/lib/session-user";

export function requireRegisteredAccount<T extends SessionUserLike>(
  user: T | null | undefined,
): asserts user is RegisteredSessionUser<T> {
  if (!isRegisteredSessionUser(user)) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in to a registered account to manage billing.",
    });
  }
}
