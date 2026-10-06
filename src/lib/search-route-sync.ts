/** Keeps our own history writes from being replayed as external navigation. */
export function createSearchRouteSync(writeUrl: (url: string) => void) {
  let writtenUrl: string | null = null;
  let onUpdate: (() => void) | null = null;

  return {
    push(url: string) {
      writtenUrl = url;
      writeUrl(url);
    },
    start(callback: () => void) {
      onUpdate = callback;
    },
    dispose() {
      writtenUrl = null;
      onUpdate = null;
    },
    onUrlChange(url: string) {
      if (url === writtenUrl) return;
      writtenUrl = null;
      onUpdate?.();
    },
  };
}
