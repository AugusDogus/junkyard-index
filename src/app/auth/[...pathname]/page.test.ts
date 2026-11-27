import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let directory: string;
let script: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "auth-page-"));
  const entry = join(directory, "entry.ts");
  await Bun.write(
    entry,
    `
    import AuthPage, { generateMetadata } from ${JSON.stringify(resolve("src/app/auth/[...pathname]/page.tsx"))};
    // Reading the request would render the page on every visit instead of
    // serving it from the CDN.
    const props = {
      params: Promise.resolve({ pathname: [process.argv[2]] }),
      searchParams: {
        then() {
          throw new Error("read searchParams");
        },
      },
    };
    try {
      await AuthPage(props);
      console.log(JSON.stringify({ form: true, metadata: await generateMetadata(props) }));
    } catch (error) {
      if (error instanceof Error && "digest" in error) {
        console.log(JSON.stringify({ redirect: error.digest }));
      } else throw error;
    }
  `,
  );
  const build = await Bun.build({
    entrypoints: [entry],
    target: "bun",
    external: ["react", "react/jsx-runtime"],
    plugins: [
      {
        name: "auth-request-boundary",
        setup(builder) {
          builder.onLoad({ filter: /src\/lib\/auth\.ts$/ }, () => ({
            contents:
              'export const auth = { api: { async getSession() { throw new Error("read the session"); } } };',
            loader: "js",
          }));
          builder.onLoad({ filter: /next\/headers\.js$/ }, () => ({
            contents:
              'export async function headers() { throw new Error("read headers"); }',
            loader: "js",
          }));
          // Keep the page's routing logic real; its child components aren't rendered here.
          builder.onLoad({ filter: /src\/components\// }, () => ({
            contents:
              "export const PublicPageShell = () => null; export const AuthCard = () => null; export const SignInForm = () => null; export const SignUpForm = () => null; export const ForgotPasswordForm = () => null; export const ResetPasswordForm = () => null; export const SignedInRedirect = () => null;",
            loader: "js",
          }));
        },
      },
    ],
  });
  const output = build.outputs[0];
  if (!build.success || !output) throw new Error(build.logs.join("\n"));
  script = join(directory, "run.mjs");
  await Bun.write(script, await output.text());
  // Resolve the external React runtime from the repository, not the temp directory.
  await Bun.write(join(directory, "package.json"), '{"type":"module"}');
}, 30_000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function openAuth(route: string) {
  const result = Bun.spawn(["bun", script, route], {
    env: { ...process.env, NODE_PATH: resolve("node_modules") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, errors, status] = await Promise.all([
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
    result.exited,
  ]);
  if (status !== 0) throw new Error(errors);
  return output;
}

for (const [route, title] of [
  ["sign-in", "Sign in"],
  ["sign-up", "Create an account"],
  ["forgot-password", "Forgot password"],
  ["reset-password", "Reset password"],
] as const) {
  test(`${route} renders its form and title without reading the request`, async () => {
    const result = await openAuth(route);
    expect(result).toContain('"form":true');
    expect(result).toContain(`"title":"${title}"`);
  });
}
