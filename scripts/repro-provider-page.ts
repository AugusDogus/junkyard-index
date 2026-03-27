import "dotenv/config";
import buildQuery from "odata-query";
import { Schema } from "effect";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { API_ENDPOINTS } from "~/lib/constants";
import { Row52VehicleSchema } from "~/server/ingestion/row52-connector";

// Minimal provider repro helper for exact failing pages.
// This is intentionally DB-safe: it only fetches one provider page and saves raw JSON to tmp/.
const ROW52_PAGE_SIZE = 1000;

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function requireArg(flag: string): string {
  const value = getArg(flag);
  if (!value) {
    throw new Error(`Missing required argument: ${flag}`);
  }
  return value;
}

function saveOutput(filename: string, payload: unknown) {
  mkdirSync(resolve(process.cwd(), "tmp"), { recursive: true });
  const outputPath = resolve(process.cwd(), "tmp", filename);
  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  return outputPath;
}

async function runRow52(skip: number) {
  const query = buildQuery({
    filter: { isActive: true },
    expand: ["model($expand=make)", "location($expand=state)", "images"],
    orderBy: "dateAdded desc",
    top: ROW52_PAGE_SIZE,
    skip,
    count: false,
  });
  const url = `${API_ENDPOINTS.ROW52_BASE}${API_ENDPOINTS.ROW52_VEHICLES}${query}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Row52 returned HTTP ${response.status}`);
  }

  const raw = (await response.json()) as unknown;
  const decode = Schema.decodeUnknownSync(
    Schema.Struct({
      "@odata.context": Schema.String,
      "@odata.count": Schema.optional(Schema.Number),
      value: Schema.Array(Row52VehicleSchema),
    }),
  );

  try {
    const decoded = decode(raw);
    const outputPath = saveOutput(`row52-skip-${skip}.json`, raw);
    console.log(
      JSON.stringify(
        {
          provider: "row52",
          skip,
          ok: true,
          vehicles: decoded.value.length,
          savedTo: outputPath,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const outputPath = saveOutput(`row52-skip-${skip}-failed.json`, raw);
    console.log(
      JSON.stringify(
        {
          provider: "row52",
          skip,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          savedTo: outputPath,
        },
        null,
        2,
      ),
    );
  }
}

async function runPyp(page: number) {
  const helperPath = resolve(
    process.cwd(),
    "scripts",
    "repro-pyp-page-node.mjs",
  );
  execFileSync("node", [helperPath, "--page", String(page)], {
    stdio: "inherit",
    env: process.env,
  });
}

async function main() {
  const provider = requireArg("--provider");

  if (provider === "row52") {
    await runRow52(Number.parseInt(requireArg("--skip"), 10));
    return;
  }

  if (provider === "pyp") {
    await runPyp(Number.parseInt(requireArg("--page"), 10));
    return;
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

await main();
