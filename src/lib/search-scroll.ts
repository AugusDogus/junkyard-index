import { z } from "zod";

const schema = z.object({
  width: z.number().positive(),
  scrollY: z.number().nonnegative(),
  rowSizes: z.array(z.number().nonnegative()),
  savedAt: z.number(),
});
type Snapshot = z.infer<typeof schema>;
const key = (state: string) => `junkyard-index:search-scroll:v1:${state}`;

function read(state: string): Snapshot | null {
  try {
    const parsed = schema.safeParse(
      JSON.parse(sessionStorage.getItem(key(state)) ?? "null"),
    );
    return parsed.success &&
      Date.now() - parsed.data.savedAt < 30 * 60_000 &&
      parsed.data.width === window.innerWidth
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}
function write(state: string, snapshot: Omit<Snapshot, "savedAt">) {
  try {
    sessionStorage.setItem(
      key(state),
      JSON.stringify({ ...snapshot, savedAt: Date.now() }),
    );
  } catch {
    /* Scroll restoration is optional when tab storage is unavailable. */
  }
}
interface ScrollHost {
  readonly scrollY: number;
  scrollTo(x: number, y: number): void;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(id: number): void;
  addEventListener(
    type: string,
    callback: () => void,
    options?: AddEventListenerOptions,
  ): void;
  removeEventListener(type: string, callback: () => void): void;
}

/** One restoration attempt per mount. User input takes priority, including
 * input received while waiting for the cached pages and viewport measurements. */
function prepareRestoration(host: ScrollHost = window) {
  let phase: "waiting" | "scheduled" | "adjusting" | "done" = "waiting";
  let frame = 0;
  let targetY = 0;
  let startingY = host.scrollY;
  const active = () => phase !== "done";
  const inputEvents = ["pointerdown", "keydown", "wheel", "touchstart"];
  const cancel = () => {
    phase = "done";
    host.cancelAnimationFrame(frame);
    for (const event of inputEvents) host.removeEventListener(event, cancel);
    host.removeEventListener("scroll", onScroll);
  };
  const onScroll = () => {
    // Native reload restoration can scroll before our first frame. Input
    // listeners distinguish user intent while the cached pages are mounting.
    if (
      (phase === "scheduled" && Math.abs(host.scrollY - startingY) > 1) ||
      (phase === "adjusting" && Math.abs(host.scrollY - targetY) > 1)
    )
      cancel();
  };
  for (const event of inputEvents)
    host.addEventListener(event, cancel, { passive: true });
  host.addEventListener("scroll", onScroll, { passive: true });
  return {
    pending: () => phase === "waiting",
    cancel,
    start(scrollY: number) {
      if (phase !== "waiting") return;
      phase = "scheduled";
      targetY = scrollY;
      startingY = host.scrollY;
      frame = host.requestAnimationFrame(() => {
        if (!active()) return;
        phase = "adjusting";
        host.scrollTo(0, targetY);
        if (!active()) return;
        // Let the restored virtual rows render before the final adjustment.
        frame = host.requestAnimationFrame(() => {
          if (!active()) return;
          host.scrollTo(0, targetY);
          cancel();
        });
      });
    },
  };
}

export const SearchScroll = { read, write, prepareRestoration } as const;
