// Stands in for next/dist/client/components/app-router-instance, which Next's
// own Link (next/dist/client/app-dir/link) calls for a client navigation.
// The fixture has no app router, so the shared-search fixture handles each
// navigation the way Next's router would.

/** A client navigation Next's router starts. */
export type FixtureNavigation = {
  href: string;
  type: "push" | "replace";
  scroll: boolean;
};

let handle: (navigation: FixtureNavigation) => void = () => {};

export const FixtureAppRouter = {
  /** Sets what a navigation does once the fixture mounts. */
  onNavigate(handler: (navigation: FixtureNavigation) => void): void {
    handle = handler;
  },
} as const;

/** What Next's Link calls once it decides the router owns a click. */
export function dispatchNavigateAction(
  href: string,
  navigateType: "push" | "replace",
  shouldScroll: boolean,
): void {
  handle({ href, type: navigateType, scroll: shouldScroll });
}

/** No router state, so Next's links prefetch nothing. */
export function getCurrentAppRouterState(): null {
  return null;
}
