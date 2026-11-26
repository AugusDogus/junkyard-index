import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const SCRIPT = resolve(
  import.meta.dir,
  "../../../scripts/vercel-ignore-build.sh",
);

let repo = "";

function git(...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: repo });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${repo}: ${result.stderr.toString()}`,
    );
  }
  return result.stdout.toString().trim();
}

/** Commits the given files on top of HEAD and returns the new SHA. */
async function commit(files: Record<string, string>): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), content);
  }
  git("add", "-A");
  git("commit", "--quiet", "--allow-empty", "-m", "change");
  return git("rev-parse", "HEAD");
}

/** Exit 0 skips the deployment; exit 1 builds it. */
function ignoreExitCode(previousSha: string | undefined): number {
  const env: Record<string, string | undefined> = {
    ...process.env,
    VERCEL_GIT_PREVIOUS_SHA: previousSha,
  };
  if (previousSha === undefined) delete env.VERCEL_GIT_PREVIOUS_SHA;
  return Bun.spawnSync(["bash", SCRIPT], { cwd: repo, env }).exitCode;
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "vercel-ignore-build-"));
  git("init", "--quiet");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  await commit({ "src/app/page.tsx": "export default 1;\n" });
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("Vercel ignored build step", () => {
  test("builds the first deployment of a branch", () => {
    expect(ignoreExitCode(undefined)).toBe(1);
    expect(ignoreExitCode("")).toBe(1);
  });

  test("builds when the previous deployment's commit is unreachable", () => {
    expect(ignoreExitCode("0123456789abcdef0123456789abcdef01234567")).toBe(1);
  });

  test("skips a push that changes only docs, tests, CI and agent config", async () => {
    const previous = git("rev-parse", "HEAD");
    await commit({
      "docs/runbooks/example.md": "# Runbook\n",
      "README.md": "# Readme\n",
      "src/app/page.test.ts": "test\n",
      "tests/browser/example.test.ts": "test\n",
      ".github/workflows/ci.yml": "name: CI\n",
      ".agents/skills/example/SKILL.md": "skill\n",
    });
    expect(ignoreExitCode(previous)).toBe(0);
  });

  test("builds when any shipped path changes", async () => {
    const previous = git("rev-parse", "HEAD");
    await commit({
      "docs/example.md": "more docs\n",
      "drizzle/0001_example.sql": "select 1;\n",
    });
    expect(ignoreExitCode(previous)).toBe(1);
  });

  test("builds an empty commit pushed to force a redeploy", async () => {
    const previous = git("rev-parse", "HEAD");
    await commit({});
    expect(ignoreExitCode(previous)).toBe(1);
  });
});
