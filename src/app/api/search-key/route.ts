import { auth } from "~/lib/auth";
import { grantSearchKey } from "~/server/search-key-grant";

export const dynamic = "force-dynamic";

/**
 * A fresh secured search key for this visitor's plan. Browsers call it when
 * their key nears expiry or their plan changes. Minting is local, so this
 * spends no Algolia quota.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  const grant = await grantSearchKey({
    userId: session?.user.id ?? null,
    headers: request.headers,
    nowMs: Date.now(),
  });
  return Response.json(grant, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
