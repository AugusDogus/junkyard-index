import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthCard } from "./AuthCard";
import { PasswordVisibilityButton } from "./PasswordVisibilityButton";

test("auth has one form, main landmark, and heading at every breakpoint", () => {
  const html = renderToStaticMarkup(
    <AuthCard title="Welcome back" description="Sign in">
      <form>
        <label htmlFor="email">Email</label>
        <input id="email" />
      </form>
    </AuthCard>,
  );
  expect(html.match(/<main\b/g)).toHaveLength(1);
  expect(html.match(/<form\b/g)).toHaveLength(1);
  expect(html.match(/id="email"/g)).toHaveLength(1);
  expect(html).toContain('for="email"');
  expect(html).toContain(">Welcome back</h1>");
  expect(html).not.toContain("sm:hidden");
});

test("password visibility action is named, focusable, and has a 44px target", () => {
  for (const visible of [false, true]) {
    const html = renderToStaticMarkup(
      <PasswordVisibilityButton visible={visible} onToggle={() => {}} />,
    );
    expect(html).toContain(
      `aria-label="${visible ? "Hide" : "Show"} password"`,
    );
    expect(html).not.toContain("tabindex");
    expect(html).toContain("size-11");
    expect(html).toContain("focus-visible:outline-2");
    expect(html).toContain('type="button"');
  }
});
