import "dotenv/config";
import { configureAlgoliaIndex } from "../src/server/ingestion/sync-algolia";

// Explicit owner-run deployment step. Also deletes the retired distance copy.
await configureAlgoliaIndex();
