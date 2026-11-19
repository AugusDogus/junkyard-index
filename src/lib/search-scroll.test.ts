import { expect, test } from "bun:test";
import { SearchScroll } from "./search-scroll";

function fixture() {
  const events = new EventTarget();
  const frames = new Map<number, FrameRequestCallback>();
  const positions: number[] = [];
  let frameId = 0;
  let y = 0;
  const host = {
    get scrollY() {
      return y;
    },
    scrollTo(_x: number, nextY: number) {
      y = nextY;
      positions.push(y);
    },
    requestAnimationFrame(callback: FrameRequestCallback) {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame(id: number) {
      frames.delete(id);
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
  return {
    restoration: SearchScroll.prepareRestoration(host),
    frames,
    positions,
    input: (type: string) => events.dispatchEvent(new Event(type)),
    scroll(y: number) {
      host.scrollTo(0, y);
      events.dispatchEvent(new Event("scroll"));
    },
    frame() {
      const batch = [...frames];
      frames.clear();
      for (const [, callback] of batch) callback(0);
    },
  };
}

test("restoration finishes once and ignores later starts", () => {
  const f = fixture();
  f.restoration.start(6000);
  f.frame();
  f.frame();
  expect(f.positions).toEqual([6000, 6000]);
  f.scroll(0);
  f.restoration.start(6000);
  f.frame();
  expect(f.positions).toEqual([6000, 6000, 0]);
});

for (const event of ["pointerdown", "keydown", "wheel", "touchstart"]) {
  test(`${event} cancels before pages mount or while frames are pending`, () => {
    for (const started of [false, true]) {
      const f = fixture();
      if (started) f.restoration.start(6000);
      f.input(event);
      f.restoration.start(6000);
      f.frame();
      expect(f.positions).toEqual([]);
      expect(f.frames.size).toBe(0);
    }
  });
}

test("scrolling after the first adjustment cancels the remaining frame", () => {
  const f = fixture();
  f.restoration.start(6000);
  f.frame();
  f.scroll(0);
  f.frame();
  expect(f.positions).toEqual([6000, 0]);
  expect(f.frames.size).toBe(0);
});

test("scrolling before the first adjustment cancels the pending frame", () => {
  const f = fixture();
  f.restoration.start(6000);
  f.scroll(100);
  f.frame();
  expect(f.positions).toEqual([100]);
  expect(f.frames.size).toBe(0);
});
