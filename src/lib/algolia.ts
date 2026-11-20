import "server-only";
import { algoliasearch, type Algoliasearch } from "algoliasearch";
import { env } from "~/env";
import { AlgoliaDeployment } from "~/lib/algolia-deployment";
export { ALGOLIA_INDEX_NAME } from "~/lib/constants";

let adminClient: Algoliasearch | undefined;

/**
 * The Algolia write client. It is built on first use, so pages that import
 * an ingestion module still render where writes are refused.
 *
 * @throws AlgoliaAdminClientRefused outside production when the app is the
 * production Algolia app. Nothing is sent to Algolia.
 */
export function getAlgoliaAdminClient(): Algoliasearch {
  if (adminClient) return adminClient;
  const access = AlgoliaDeployment.adminAccess(
    AlgoliaDeployment.parse(process.env.VERCEL_ENV),
    env.NEXT_PUBLIC_ALGOLIA_APP_ID,
  );
  if (access.kind === "refused") throw access.error;
  adminClient = algoliasearch(
    env.NEXT_PUBLIC_ALGOLIA_APP_ID,
    env.ALGOLIA_WRITE_API_KEY,
  );
  return adminClient;
}
