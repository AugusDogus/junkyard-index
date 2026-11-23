import { auth } from "~/lib/auth";
import { searchKeyGrants } from "~/server/search-key-grant";
import { SearchKeyGranter } from "~/server/search-key-granter";

export const dynamic = "force-dynamic";

/**
 * A fresh secured search key for this visitor's plan and the sources hidden
 * now. Browsers call it when their key nears expiry (every 10 minutes while
 * searching) or their plan changes, so the plan is looked up directly rather
 * than from the tier cache. Minting is local, so this spends no Algolia
 * quota.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  return SearchKeyGranter.respond(searchKeyGrants.forRenewal, {
    userId: session?.user.id ?? null,
    headers: request.headers,
    nowMs: Date.now(),
  });
}
