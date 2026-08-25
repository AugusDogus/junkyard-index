export type BuildStep = readonly [command: string, ...args: string[]];

const BUILD_STEP = ["bun", "run", "build"] as const satisfies BuildStep;
const MIGRATE_STEP = ["bun", "run", "db:migrate"] as const satisfies BuildStep;

export function getVercelBuildSteps(
  vercelEnvironment: string | undefined,
): readonly BuildStep[] {
  const isDeployment =
    vercelEnvironment === "production" || vercelEnvironment === "preview";
  return isDeployment
    ? [MIGRATE_STEP, BUILD_STEP]
    : [BUILD_STEP];
}

async function runStep([command, ...args]: BuildStep): Promise<number> {
  const process = Bun.spawn([command, ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  return process.exited;
}

export async function runVercelBuild(
  vercelEnvironment: string | undefined,
): Promise<number> {
  for (const step of getVercelBuildSteps(vercelEnvironment)) {
    const exitCode = await runStep(step);
    if (exitCode !== 0) return exitCode;
  }

  return 0;
}

if (import.meta.main) {
  process.exit(await runVercelBuild(process.env.VERCEL_ENV));
}
