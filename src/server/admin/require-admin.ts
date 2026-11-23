import "server-only";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { env } from "~/env";
import { auth } from "~/lib/auth";
import { AdminAccess } from "./admin-access";

/**
 * Whether this request's user is an admin. Cached per request, so a layout,
 * its metadata and its page read the session once. Use `requireAdmin` to
 * gate; this is for code that must not throw, such as metadata.
 */
export const readAdminAccess = cache(async (): Promise<AdminAccess> => {
  const session = await auth.api.getSession({ headers: await headers() });
  return AdminAccess.decide(
    session,
    AdminAccess.parseUserIds(env.ADMIN_USER_IDS),
  );
});

/**
 * The admin dashboard's one server-side gate. Every admin page, layout,
 * server action, route and tRPC procedure calls it first. Anyone who is not
 * a listed admin, signed out included, gets the site's ordinary 404 page
 * and no admin data. (That 404 still links the admin route's client
 * scripts, as Next.js does for any route, so it is not byte-identical to a
 * path that does not exist.)
 */
export async function requireAdmin(): Promise<{ userId: string }> {
  const access = await readAdminAccess();
  if (access.status === "denied") notFound();
  return { userId: access.userId };
}

/**
 * An admin segment's metadata, for its generateMetadata. Non-admins get
 * none, because Next.js sends a segment's metadata (title, og:title) with
 * its 404 too. Never export static `metadata` from an admin segment.
 */
export async function adminMetadata(metadata: Metadata): Promise<Metadata> {
  const access = await readAdminAccess();
  return access.status === "denied" ? {} : metadata;
}
