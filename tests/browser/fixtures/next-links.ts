// Stands in for next/dist/client/components/links, the prefetch bookkeeping
// Next's Link keeps per mounted link. The fixture prefetches nothing; the
// Link's click handling stays Next's own.

export const IDLE_LINK_STATUS = { pending: false };

export function mountLinkInstance(): null {
  return null;
}

export function unmountLinkForCurrentNavigation(): void {}

export function unmountPrefetchableInstance(): void {}

export function onNavigationIntent(): void {}
