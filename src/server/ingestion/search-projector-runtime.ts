import { env } from "~/env";
import { ALGOLIA_INDEX_NAME } from "~/lib/algolia";
import { AlgoliaDeployment } from "~/lib/algolia-deployment";
import { db, dbClient } from "~/lib/db";
import { AlgoliaSearchIndexWriter } from "./algolia-search-index-writer";
import { ConsumerFlags } from "./consumer-flags";
import { PublicationModeFlag } from "./publication-mode-flag";
import {
  SearchProjector,
  type SearchProjectorContext,
  type SearchProjectorDue,
} from "./search-projector";
import type { SearchProjectorTick } from "./search-projector-consumer";
import { projectSearchVehicles } from "./vehicle-search-projection";

function deployment() {
  return AlgoliaDeployment.parse(process.env.VERCEL_ENV);
}

function context(): SearchProjectorContext {
  return {
    database: db,
    client: dbClient,
    writer: AlgoliaSearchIndexWriter,
    environment: deployment(),
    indexName: ALGOLIA_INDEX_NAME,
    project: (rows) => projectSearchVehicles(db, [...rows]),
    now: () => new Date(),
  };
}

/** Why this deployment's projector does nothing, if it does nothing. */
async function precondition(): Promise<Extract<
  SearchProjectorTick,
  { status: "inline_mode" | "mode_unavailable" | "paused" | "refused" }
> | null> {
  switch (await PublicationModeFlag.mode()) {
    case "inline":
      return { status: "inline_mode" };
    case "unavailable":
      return { status: "mode_unavailable" };
    case "decoupled":
      break;
  }
  if ((await ConsumerFlags.mode("search-projector")) === "paused") {
    return { status: "paused" };
  }
  const access = AlgoliaDeployment.adminAccess(
    deployment(),
    env.NEXT_PUBLIC_ALGOLIA_APP_ID,
  );
  if (access.kind === "refused") {
    return { status: "refused", message: access.error.message };
  }
  return null;
}

/** One projector step with this deployment's database, flags and Algolia. */
export async function runSearchProjectorTick(): Promise<SearchProjectorTick> {
  return (await precondition()) ?? SearchProjector.step(context());
}

/** Whether the projector has work now; reads flags and Turso, never Algolia. */
export async function searchProjectorDueNow(
  now: Date,
): Promise<
  | Extract<
      SearchProjectorTick,
      { status: "inline_mode" | "mode_unavailable" | "paused" | "refused" }
    >
  | SearchProjectorDue
> {
  return (await precondition()) ?? SearchProjector.due(db, deployment(), now);
}
