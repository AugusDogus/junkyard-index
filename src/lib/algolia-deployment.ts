/** The Algolia app that serves production search. Its id is public. */
export const PRODUCTION_ALGOLIA_APP_ID = "1W23RR64C2";

/**
 * Where an Algolia client runs, from `VERCEL_ENV`. "local" is any process
 * outside a Vercel deployment: tests, scripts, and plain `next dev`.
 */
export type AlgoliaDeployment =
  | "production"
  | "preview"
  | "development"
  | "local";

export class AlgoliaAdminClientRefused extends Error {
  readonly _tag = "AlgoliaAdminClientRefused";

  constructor(readonly deployment: Exclude<AlgoliaDeployment, "production">) {
    super(
      `Refused to create the Algolia admin client: app ${PRODUCTION_ALGOLIA_APP_ID} is the production Algolia app, and this process runs as VERCEL_ENV=${deployment === "local" ? "(unset)" : deployment}, not production. Nothing was sent to Algolia, and the production index is unchanged. Give Preview and Development a separate Algolia app's NEXT_PUBLIC_ALGOLIA_APP_ID and ALGOLIA_WRITE_API_KEY. For an owner-approved production write from a local shell, run that one command with VERCEL_ENV=production.`,
    );
    this.name = "AlgoliaAdminClientRefused";
  }
}

export type AlgoliaAdminAccess =
  | { kind: "allowed" }
  | { kind: "refused"; error: AlgoliaAdminClientRefused };

export const AlgoliaDeployment = {
  parse(vercelEnv: string | undefined): AlgoliaDeployment {
    switch (vercelEnv) {
      case "production":
      case "preview":
      case "development":
        return vercelEnv;
      default:
        return "local";
    }
  },

  /**
   * The deployment's name for an index. Production keeps the base name, and
   * so does a local process, which reads whichever app its keys point at.
   * Vercel's preview and development deployments get their own prefix, so
   * they never share an index with each other or with production.
   */
  indexName(deployment: AlgoliaDeployment, baseName: string): string {
    switch (deployment) {
      case "production":
      case "local":
        return baseName;
      case "preview":
      case "development":
        return `${deployment}_${baseName}`;
    }
  },

  /**
   * Whether this deployment may hold the write key for an app. Only
   * production may write to the production app.
   */
  adminAccess(
    deployment: AlgoliaDeployment,
    appId: string,
  ): AlgoliaAdminAccess {
    if (deployment === "production" || appId !== PRODUCTION_ALGOLIA_APP_ID) {
      return { kind: "allowed" };
    }
    return {
      kind: "refused",
      error: new AlgoliaAdminClientRefused(deployment),
    };
  },
} as const;
