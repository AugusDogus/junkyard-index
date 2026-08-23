import { Context } from "effect";

export class Database extends Context.Tag("ingestion/Database")<
  Database,
  typeof import("~/lib/db").db
>() {}

export interface IngestionConfig {
  betterStackHeartbeatUrl: string | undefined;
  hyperbrowserApiKey: string;
}

export class Config extends Context.Tag("ingestion/Config")<
  Config,
  IngestionConfig
>() {}
