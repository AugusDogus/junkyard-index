/**
 * Client navigations Next's app router starts: a Link click, `router.push`
 * or `router.replace` ("push" or "replace"), and Back or Forward
 * ("traverse"). Next reports them to `onRouterTransitionStart` in
 * `src/instrumentation-client.ts`, before it requests the new page. Clicks
 * Next leaves to the browser (a plain `<a>`, a modified or middle click, a
 * new tab, a download, another origin) start none.
 */
export type RouterTransition = {
  href: string;
  type: "push" | "replace" | "traverse";
};

type Listener = (transition: RouterTransition) => void;

const listeners = new Set<Listener>();

export const RouterTransitions = {
  /** Called by `onRouterTransitionStart` as Next starts a navigation. */
  start(transition: RouterTransition): void {
    for (const listener of listeners) listener(transition);
  },
  /** Calls `listener` for each navigation Next starts; returns unsubscribe. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
} as const;
