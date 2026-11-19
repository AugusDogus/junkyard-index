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
    const props = {
      params: Promise.resolve({ pathname: [process.argv[2]] }),
      searchParams: Promise.resolve(JSON.parse(process.argv[3])),
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
              'export const auth = { api: { async getSession() { return process.argv[4] === "signed-in" ? { user: { id: "fixture" } } : null; } } };',
            loader: "js",
          }));
          builder.onLoad({ filter: /next\/headers\.js$/ }, () => ({
            contents:
              "export async function headers() { return new Headers(); }",
            loader: "js",
          }));
          // Keep the page's routing logic real; its child components aren't rendered here.
          builder.onLoad({ filter: /src\/components\// }, () => ({
            contents:
              "export const PublicPageShell = () => null; export const AuthCard = () => null; export const SignInForm = () => null; export const SignUpForm = () => null; export const ForgotPasswordForm = () => null; export const ResetPasswordForm = () => null;",
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

async function openAuth(route: string, returnTo: unknown, signedIn = true) {
  const result = Bun.spawn(
    [
      "bun",
      script,
      route,
      JSON.stringify({ returnTo }),
      signedIn ? "signed-in" : "signed-out",
    ],
    {
      env: { ...process.env, NODE_PATH: resolve("node_modules") },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [output, errors, status] = await Promise.all([
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
    result.exited,
  ]);
  if (status !== 0) throw new Error(errors);
  return output;
}

for (const route of ["sign-in", "sign-up"]) {
  for (const [destination, expected] of [
    ["/search?q=Saab&saveSearch=1", "/search?q=Saab&saveSearch=1"],
    ["%2Fsearch%3Fq%3DSaab%26saveSearch%3D1", "/search?q=Saab&saveSearch=1"],
    ["https://evil.example/", "/search"],
    ["//evil.example", "/search"],
    ["/auth/sign-up", "/search"],
    ["/auth/sign-in?returnTo=%2Fsearch", "/search"],
    ["/auth/unknown", "/search"],
    ["/auth/%73ign-in", "/search"],
  ]) {
    test(`signed-in ${route} redirects ${destination} safely`, async () => {
      expect(await openAuth(route, destination)).toContain(
        `NEXT_REDIRECT;replace;${expected};307;`,
      );
    });
  }
  test(`signed-out ${route} keeps its form and page title`, async () => {
    const result = await openAuth(route, "/search?q=Saab&saveSearch=1", false);
    expect(result).toContain('"form":true');
    expect(result).toContain(
      route === "sign-in" ? '"title":"Sign in"' : '"title":"Create an account"',
    );
  });
}

test("signed-in users can still recover and reset passwords", async () => {
  for (const route of ["forgot-password", "reset-password"]) {
    expect(await openAuth(route, "/search")).toContain('"form":true');
  }
});
