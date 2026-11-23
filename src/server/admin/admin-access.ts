/**
 * Who may open the admin dashboard: a signed-in user whose Better Auth id is
 * in ADMIN_USER_IDS. Pure, so the rule is tested apart from the request;
 * `requireAdmin` (require-admin.ts) applies it to every admin page.
 */
export type AdminAccess =
  | { status: "admin"; userId: string }
  | { status: "denied" };

/** The part of a Better Auth session the rule reads. */
export type AdminSession = { user: { id: string } } | null | undefined;

export const AdminAccess = {
  /** Ids from a comma-separated list; unset or blank grants no one. */
  parseUserIds(raw: string | undefined): ReadonlySet<string> {
    return new Set(
      (raw ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    );
  },

  decide(session: AdminSession, adminIds: ReadonlySet<string>): AdminAccess {
    const userId = session?.user.id;
    if (userId === undefined || !adminIds.has(userId)) {
      return { status: "denied" };
    }
    return { status: "admin", userId };
  },
} as const;
