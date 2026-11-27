import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { algoliasearch, type ApiKey } from "algoliasearch";
import { PRODUCTION_ALGOLIA_APP_ID } from "../src/lib/algolia-deployment";
import {
  type AlgoliaApiKey,
  type AlgoliaApiKeyRole,
  type AlgoliaApiKeySettings,
  AlgoliaApiKeySpec,
} from "../src/server/algolia-api-key-spec";

// Owner-run key management for the production Algolia app. Every call here is
// a /1/keys request, which Algolia does not bill as a search. Key values are
// written only to the files named on the command line (mode 0600) and never
// printed; output names keys by fingerprint. Steps and rollback:
// docs/runbooks/algolia-search-keys.md.

const USAGE = `Usage (ALGOLIA_ADMIN_API_KEY set in the environment):
  bun scripts/algolia-search-keys.ts show
  bun scripts/algolia-search-keys.ts create <new-keys.env>
  bun scripts/algolia-search-keys.ts delete-created <new-keys.env>
  bun scripts/algolia-search-keys.ts retire <fingerprint> <backup.json>
  bun scripts/algolia-search-keys.ts restore <backup.json>`;

const ENV_NAMES: Record<AlgoliaApiKeyRole, string> = {
  "browser-parent": "ALGOLIA_SEARCH_PARENT_API_KEY",
  server: "ALGOLIA_SEARCH_API_KEY",
};
const SITE_SEARCH_KEY_URL = "https://junkyardindex.com/api/search-key";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const adminKey = process.env.ALGOLIA_ADMIN_API_KEY;
if (!adminKey) {
  fail(
    `ALGOLIA_ADMIN_API_KEY is not set. Nothing was sent to Algolia. Copy the Admin API key from the Algolia dashboard (Settings, API Keys) into the environment for this one command.\n${USAGE}`,
  );
}
const client = algoliasearch(PRODUCTION_ALGOLIA_APP_ID, adminKey);

async function listKeys(): Promise<AlgoliaApiKey[]> {
  const { keys } = await client.listApiKeys();
  return keys.map((key) => AlgoliaApiKeySpec.parse(key));
}

/**
 * Polls until Algolia's answer for `value` holds `settings`. The SDK's own
 * `waitForApiKey` update check compares fields strictly, so it never sees
 * limits Algolia leaves out of its answer (0, empty) and retries until it
 * throws after the update already applied.
 */
async function waitForSettings(
  value: string,
  settings: AlgoliaApiKeySettings,
): Promise<AlgoliaApiKey> {
  for (let attempt = 1; attempt <= 30; attempt++) {
    const key = {
      ...AlgoliaApiKeySpec.parse(await client.getApiKey({ key: value })),
      value,
    };
    if (AlgoliaApiKeySpec.hasSettings(key, settings)) return key;
    await Bun.sleep(Math.min(attempt * 200, 2_000));
  }
  return fail(
    `Algolia accepted the update of key ${AlgoliaApiKeySpec.fingerprint(value)}, but its settings did not show it after 30 reads (about 50 s). Run show to see its current settings before retrying.`,
  );
}

function print(label: string, key: AlgoliaApiKey) {
  console.log(label, JSON.stringify(AlgoliaApiKeySpec.summary(key)));
}

/** Writes a file holding key values: owner-only, never over an old one. */
function writeSecretFile(path: string, text: string) {
  try {
    writeFileSync(path, text, { flag: "wx", mode: 0o600 });
  } catch (error) {
    fail(
      `Could not write ${path}: ${error instanceof Error ? error.message : String(error)}. Nothing was changed in Algolia. Pass a path that does not exist yet.`,
    );
  }
}

function readEnvFile(path: string): Map<string, string> {
  return new Map(
    readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.match(/^([A-Z_]+)="([^"]*)"$/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => [match[1] ?? "", match[2] ?? ""]),
  );
}

async function show() {
  for (const key of await listKeys()) print("key", key);
}

async function create(path: string) {
  // The file exists before the first key, so no created key goes unrecorded.
  writeSecretFile(path, "");
  for (const role of AlgoliaApiKeySpec.roles) {
    const settings: ApiKey = AlgoliaApiKeySpec.forRole(role);
    const { key } = await client.addApiKey(settings);
    appendFileSync(path, `${ENV_NAMES[role]}="${key}"\n`);
    await client.waitForApiKey({ key, operation: "add" });
    print(`created ${role} (${ENV_NAMES[role]})`, {
      ...AlgoliaApiKeySpec.parse(await client.getApiKey({ key })),
      value: key,
    });
  }
  console.log(`wrote ${path} (mode 0600). Nothing uses these keys yet.`);
}

async function deleteCreated(path: string) {
  const values = readEnvFile(path);
  for (const role of AlgoliaApiKeySpec.roles) {
    const value = values.get(ENV_NAMES[role]);
    if (!value) fail(`${path} has no ${ENV_NAMES[role]}. Nothing was deleted.`);
    const key = AlgoliaApiKeySpec.parse(await client.getApiKey({ key: value }));
    if (key.description !== AlgoliaApiKeySpec.forRole(role).description) {
      fail(
        `Key ${AlgoliaApiKeySpec.fingerprint(value)} is not a key this script created (its description differs). It was not deleted.`,
      );
    }
    await client.deleteApiKey({ key: value });
    await client.waitForApiKey({ key: value, operation: "delete" });
    console.log("deleted", role, AlgoliaApiKeySpec.fingerprint(value));
  }
}

async function retire(fingerprint: string, backupPath: string) {
  const target = (await listKeys()).find(
    (key) => AlgoliaApiKeySpec.fingerprint(key.value) === fingerprint,
  );
  if (!target) fail(`No key has fingerprint ${fingerprint}. Run show.`);
  const response = await fetch(SITE_SEARCH_KEY_URL, { cache: "no-store" });
  const grant: unknown = await response.json();
  const browserKey =
    typeof grant === "object" &&
    grant !== null &&
    "apiKey" in grant &&
    typeof grant.apiKey === "string"
      ? grant.apiKey
      : fail(
          `${SITE_SEARCH_KEY_URL} answered HTTP ${response.status} without an apiKey. Nothing was changed; check the site before retiring a key.`,
        );
  const decision = AlgoliaApiKeySpec.retireDecision(target, browserKey);
  if (decision.kind === "refused") {
    fail(`Not retiring: ${decision.reason} Nothing was changed.`);
  }
  writeSecretFile(backupPath, JSON.stringify(target, null, 2));
  print("before", target);
  const settings = AlgoliaApiKeySpec.retired(
    target,
    new Date(),
  ) satisfies ApiKey;
  await client
    .updateApiKey({ key: target.value, apiKey: settings })
    .catch((error: unknown) =>
      fail(
        `Algolia refused the update: ${error instanceof Error ? error.message : String(error)}. The key is unchanged; ${backupPath} holds its current settings. If Algolia does not allow editing the default Search-Only key, regenerate it in the dashboard instead (docs/runbooks/algolia-search-keys.md, step 5).`,
      ),
    );
  print("after", await waitForSettings(target.value, settings));
  console.log(
    `Retired. Undo: bun scripts/algolia-search-keys.ts restore ${backupPath}`,
  );
}

async function restore(backupPath: string) {
  const before = AlgoliaApiKeySpec.parse(
    JSON.parse(readFileSync(backupPath, "utf8")),
  );
  const settings = AlgoliaApiKeySpec.settingsOf(before) satisfies ApiKey;
  await client.updateApiKey({ key: before.value, apiKey: settings });
  print("restored", await waitForSettings(before.value, settings));
}

const [command, first, second] = process.argv.slice(2);
switch (command) {
  case "show":
    await show();
    break;
  case "create":
    await create(first ?? fail(USAGE));
    break;
  case "delete-created":
    await deleteCreated(first ?? fail(USAGE));
    break;
  case "retire":
    await retire(first ?? fail(USAGE), second ?? fail(USAGE));
    break;
  case "restore":
    await restore(first ?? fail(USAGE));
    break;
  default:
    fail(USAGE);
}
