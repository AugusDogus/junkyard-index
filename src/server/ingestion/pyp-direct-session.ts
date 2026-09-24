import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect, Scope } from "effect";
import { API_ENDPOINTS } from "~/lib/constants";
import type { Location } from "~/lib/types";
import { PypSessionError } from "./errors";
import {
  decodePypFilterResponse,
  decodePypLocations,
  type PypFilterResponse,
} from "./pyp-api";

export interface PypSession {
  readonly locations: Location[];
  fetchFilterPage(
    storeCode: string,
    pageNumber: number,
    pageSize: number,
  ): Effect.Effect<PypFilterResponse, PypSessionError>;
}

const execFileAsync = promisify(execFile);
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const STATUS_MARKER = "\n__PYP_HTTP_STATUS__";

interface CurlContext {
  baseUrl: string;
  cookieFile: string;
}

interface DirectState extends CurlContext {
  directory: string;
  csrfToken: string;
  locations: Location[];
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function curlFailure(cause: unknown): Error {
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? String(cause.code)
      : "unknown";
  return new Error(
    `PYP direct HTTP request failed (curl exit ${code}). Check curl availability and PYP access from this runtime.`,
  );
}

async function request(
  context: CurlContext,
  path: string,
  headers: string[],
): Promise<string> {
  const url = `${context.baseUrl}${path}`;
  const args = [
    "--max-time",
    "45",
    "--silent",
    "--show-error",
    "--cookie",
    context.cookieFile,
    "--cookie-jar",
    context.cookieFile,
    "--user-agent",
    USER_AGENT,
    ...headers.flatMap((header) => ["--header", header]),
    "--write-out",
    `${STATUS_MARKER}%{http_code}`,
    url,
  ];
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("curl", args, {
      timeout: 50_000,
      maxBuffer: 8 * 1024 * 1024,
    }));
  } catch (cause) {
    throw curlFailure(cause);
  }
  const marker = stdout.lastIndexOf(STATUS_MARKER);
  if (marker === -1) throw new Error("PYP curl response omitted HTTP status");
  const status = stdout.slice(marker + STATUS_MARKER.length);
  if (status !== "200") {
    throw new Error(`PYP direct HTTP request returned status ${status}`);
  }
  return stdout.slice(0, marker);
}

function readJsonArray(html: string, start: number): unknown {
  if (html[start] !== "[") throw new Error("PYP location list is not an array");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "[") depth++;
    else if (char === "]") {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(start, index + 1));
    }
  }
  throw new Error("PYP location list did not close");
}

export function parsePypDirectoryHtml(html: string): {
  csrfToken: string;
  locations: Location[];
} {
  const tokenInput = (html.match(/<input\b[^>]*>/gi) ?? []).find((tag) =>
    /\bname\s*=\s*["']__RequestVerificationToken["']/i.test(tag),
  );
  const csrfToken = tokenInput?.match(/\bvalue\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!csrfToken) throw new Error("PYP inventory page omitted CSRF token");

  const assignment = /\bvar\s+_locationList\s*=\s*/.exec(html);
  if (!assignment) throw new Error("PYP inventory page omitted location list");
  const locations = decodePypLocations(
    readJsonArray(html, assignment.index + assignment[0].length),
  );
  if (locations.length < 20) {
    throw new Error(
      `PYP direct inventory page returned ${locations.length} valid locations; expected at least 20`,
    );
  }
  return { csrfToken, locations };
}

async function loadDirectory(context: CurlContext): Promise<{
  csrfToken: string;
  locations: Location[];
}> {
  await rm(context.cookieFile, { force: true });
  const html = await request(context, API_ENDPOINTS.LOCATION_PAGE, [
    "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language: en-US,en;q=0.9",
    `Referer: ${context.baseUrl}/`,
  ]);
  return parsePypDirectoryHtml(html);
}

async function openDirectState(options: {
  baseUrl: string;
  temporaryRoot: string;
}): Promise<DirectState> {
  const directory = await mkdtemp(join(options.temporaryRoot, "pyp-direct-"));
  const context = {
    baseUrl: options.baseUrl,
    cookieFile: join(directory, "cookies.txt"),
  };
  try {
    const directoryData = await loadDirectory(context);
    return { directory, ...context, ...directoryData };
  } catch (cause) {
    await rm(directory, { recursive: true, force: true });
    throw cause;
  }
}

function directSession(state: DirectState): PypSession {
  const fetchRawFilterPage = (
    storeCodes: string,
    pageNumber: number,
    pageSize: number,
  ) =>
    Effect.tryPromise({
      try: async (): Promise<unknown> => {
        const query = new URLSearchParams({
          store: storeCodes,
          filter: "",
          page: String(pageNumber),
          pageSize: String(pageSize),
        });
        const body = await request(
          state,
          `${API_ENDPOINTS.PYP_FILTER_INVENTORY}?${query}`,
          [
            "Accept: application/json",
            "Accept-Language: en-US,en;q=0.9",
            `Referer: ${state.baseUrl}${API_ENDPOINTS.LOCATION_PAGE}`,
            "X-Requested-With: XMLHttpRequest",
            `RequestVerificationToken: ${state.csrfToken}`,
          ],
        );
        return JSON.parse(body);
      },
      catch: (cause) => new PypSessionError({ phase: "fetch", cause }),
    });

  return {
    get locations() {
      return state.locations;
    },
    fetchFilterPage: (storeCode, pageNumber, pageSize) =>
      fetchRawFilterPage(storeCode, pageNumber, pageSize).pipe(
        Effect.flatMap((raw) =>
          Effect.try({
            try: (): PypFilterResponse => decodePypFilterResponse(raw),
            catch: (cause) => new PypSessionError({ phase: "fetch", cause }),
          }),
        ),
      ),
  };
}

export function acquireDirectPypSession(
  options: { baseUrl?: string; temporaryRoot?: string } = {},
): Effect.Effect<PypSession, PypSessionError, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        openDirectState({
          baseUrl: options.baseUrl ?? API_ENDPOINTS.PYP_BASE,
          temporaryRoot: options.temporaryRoot ?? tmpdir(),
        }),
      catch: (cause) => new PypSessionError({ phase: "open", cause }),
    }),
    (state) =>
      Effect.tryPromise({
        try: () => rm(state.directory, { recursive: true, force: true }),
        catch: toError,
      }).pipe(Effect.catchAll(() => Effect.void)),
  ).pipe(Effect.map(directSession));
}
