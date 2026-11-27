import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createRoot } from "react-dom/client";
import { SignedInRedirect } from "~/components/auth/SignedInRedirect";

declare global {
  interface Window {
    navigations: string[];
  }
}

window.navigations = [];
const record = (type: string) => (href: string) => {
  window.navigations.push(`${type} ${href}`);
};
const router = {
  back() {},
  forward() {},
  refresh() {},
  hmrRefresh() {},
  push: record("push"),
  replace: record("replace"),
  async prefetch() {},
};

const root = document.querySelector("#root");
if (root)
  createRoot(root).render(
    <AppRouterContext.Provider value={router}>
      <SignedInRedirect />
      <p>Rendered</p>
    </AppRouterContext.Provider>,
  );
