import { randomBytes } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { Effect, Schema } from "effect";
import { UpullRPartsProviderError } from "./upullrparts-client";
import { UPULLRPARTS_SEARCH_SERVER_SOURCE } from "./upullrparts-search-server";
import type {
  UpullRPartsSearch,
  UpullRPartsSearchParams,
} from "./upullrparts-make-crawl";

/**
 * upullrparts.com challenges Browserbase's IPs with a SiteGround captcha and
 * only issues Turnstile tokens to a headed browser, so searches run in a
 * persistent Vercel Sandbox. Its filesystem keeps Chromium and Xvfb between
 * sessions; bump the version to reinstall them.
 */
const SANDBOX_NAME = "upullrparts-search";
const SETUP_VERSION = "2";
const APP_DIR = "/vercel/sandbox/upullrparts";
const READY_MARKER = `${APP_DIR}/.setup-v${SETUP_VERSION}`;
const PORT = 3000;
const WORKERS = 6;
const SESSION_TIMEOUT_MS = 20 * 60 * 1000;
const SEARCH_TIMEOUT_MS = 120_000;
const HEALTH_TIMEOUT_MS = 90_000;

const SETUP_SCRIPT = `set -euo pipefail
mkdir -p ${APP_DIR}
cd ${APP_DIR}
[ -f package.json ] || npm init -y >/dev/null
# The sandbox runs Ubuntu 26.04, which Playwright supports from 1.63.
npm install --no-audit --no-fund playwright@1.64.1
npx playwright install chromium
sudo npx playwright install-deps chromium
sudo apt-get install -y xvfb
touch ${READY_MARKER}`;

const SearchResponse = Schema.Union(
  Schema.Struct({ rows: Schema.Array(Schema.Unknown) }),
  Schema.Struct({ error: Schema.String }),
);

function providerError(message: string, cause?: unknown) {
  return new UpullRPartsProviderError({
    cause: new Error(
      cause instanceof Error ? `${message}: ${cause.message}` : message,
    ),
  });
}

async function ensureSetup(sandbox: Sandbox) {
  const check = await sandbox.runCommand("test", ["-f", READY_MARKER]);
  if (check.exitCode === 0) return;
  const setup = await sandbox.runCommand({
    cmd: "bash",
    args: ["-c", SETUP_SCRIPT],
  });
  if (setup.exitCode !== 0) {
    const output = `${await setup.stdout()}\n${await setup.stderr()}`;
    throw new Error(
      `sandbox setup exited ${setup.exitCode}: ${output.trim().slice(-800)}`,
    );
  }
}

async function waitForHealth(baseUrl: string, auth: string) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { authorization: `Bearer ${auth}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `search server was not healthy after ${HEALTH_TIMEOUT_MS / 1000}s (${lastError})`,
  );
}

async function startSession() {
  const sandbox = await Sandbox.getOrCreate({
    name: SANDBOX_NAME,
    persistent: true,
    ports: [PORT],
    timeout: SESSION_TIMEOUT_MS,
    resources: { vcpus: 4 },
  });
  await ensureSetup(sandbox);
  await sandbox.writeFiles([
    {
      path: `${APP_DIR}/server.mjs`,
      content: UPULLRPARTS_SEARCH_SERVER_SOURCE,
    },
  ]);
  const auth = randomBytes(32).toString("hex");
  await sandbox.runCommand({
    cmd: "xvfb-run",
    args: ["-a", "node", "server.mjs"],
    cwd: APP_DIR,
    env: {
      PORT: String(PORT),
      SEARCH_AUTH_TOKEN: auth,
      SEARCH_WORKERS: String(WORKERS),
    },
    detached: true,
  });
  const domain = sandbox.domain(PORT);
  const baseUrl = domain.startsWith("http") ? domain : `https://${domain}`;
  await waitForHealth(baseUrl, auth);
  return { sandbox, baseUrl, auth };
}

function search(
  session: { baseUrl: string; auth: string },
  params: UpullRPartsSearchParams,
) {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${session.baseUrl}/search`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.auth}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });
      const body: unknown = await response.json();
      return Schema.decodeUnknownSync(SearchResponse)(body);
    },
    catch: (cause) =>
      providerError(
        `sandbox search ${JSON.stringify(params)} failed before returning rows`,
        cause,
      ),
  }).pipe(
    Effect.flatMap((result) =>
      "rows" in result
        ? Effect.succeed(result.rows)
        : Effect.fail(
            providerError(
              `sandbox search ${JSON.stringify(params)}: ${result.error}`,
            ),
          ),
    ),
  );
}

/**
 * Resumes the search sandbox, starts its server with a fresh bearer token,
 * and stops the session when the scope closes. The sandbox keeps its
 * installed browser; only the running session is stopped.
 */
export const UpullRPartsSandboxSearch = Effect.acquireRelease(
  Effect.tryPromise({
    try: startSession,
    catch: (cause) =>
      providerError(
        `could not start the ${SANDBOX_NAME} Vercel Sandbox search server`,
        cause,
      ),
  }),
  ({ sandbox }) =>
    Effect.promise(() =>
      sandbox.stop().then(
        () => undefined,
        () => undefined,
      ),
    ),
).pipe(
  Effect.map(
    (session): UpullRPartsSearch =>
      (params) =>
        search(session, params),
  ),
);
