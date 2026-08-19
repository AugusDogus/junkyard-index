import { tasks } from "@trigger.dev/sdk";
import type { searchIndexMigrationTask } from "../src/trigger/search-index-migration";

const handle = await tasks.trigger<typeof searchIndexMigrationTask>(
  "search-index-schema-v2",
  {},
  {
    idempotencyKey: "production-search-index-schema-v2",
    idempotencyKeyTTL: "6h",
  },
);

console.log(`Started Trigger.dev migration run ${handle.id}`);
