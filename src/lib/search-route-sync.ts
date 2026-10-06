/** Keeps our own history writes from being replayed as external navigation. */
export function createSearchRouteSync(writeUrl: (url: string) => void) {
  let writtenUrl: string | null = null;
  let onUpdate: (() => void) | null = null;
  let updateTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelUpdate = () => {
    if (updateTimer !== null) clearTimeout(updateTimer);
    updateTimer = null;
  };

  return {
    push(url: string) {
      cancelUpdate();
      writtenUrl = url;
      writeUrl(url);
    },
    start(callback: () => void) {
      onUpdate = callback;
    },
    dispose() {
      cancelUpdate();
      writtenUrl = null;
      onUpdate = null;
    },
    onUrlChange(url: string) {
      cancelUpdate();
      if (url === writtenUrl) return;
      writtenUrl = null;
      // Let native popstate finish before Next replays the same navigation.
      // Otherwise Algolia cancels its reset write and suppresses the next edit.
      updateTimer = setTimeout(() => {
        updateTimer = null;
        onUpdate?.();
      }, 0);
    },
  };
}
