import { expect, test } from "bun:test";
import { ProxiedPhoto } from "./proxied-photo";

const proxied = ProxiedPhoto.initial(true);

test("a proxied photo that loads stays on the proxy", () => {
  expect(ProxiedPhoto.next(proxied, "load")).toEqual({
    kind: "proxy",
    loaded: true,
  });
});

test("a proxy error or a slow proxy falls back to the origin", () => {
  expect(ProxiedPhoto.next(proxied, "error")).toEqual({
    kind: "direct",
    loaded: false,
  });
  expect(ProxiedPhoto.next(proxied, "slow")).toEqual({
    kind: "direct",
    loaded: false,
  });
});

test("a loaded photo ignores the slow timer", () => {
  const loaded = ProxiedPhoto.next(proxied, "load");
  expect(ProxiedPhoto.next(loaded, "slow")).toBe(loaded);
  const direct = ProxiedPhoto.next(proxied, "error");
  expect(ProxiedPhoto.next(direct, "slow")).toBe(direct);
});

test("the origin failing too, or a photo with no proxy failing, shows the placeholder", () => {
  const direct = ProxiedPhoto.next(proxied, "error");
  expect(ProxiedPhoto.next(direct, "error")).toEqual({ kind: "failed" });
  expect(ProxiedPhoto.next(ProxiedPhoto.initial(false), "error")).toEqual({
    kind: "failed",
  });
  expect(ProxiedPhoto.next(ProxiedPhoto.initial(false), "slow")).toEqual({
    kind: "direct",
    loaded: false,
  });
});

test("loading tells whether to show the shimmer", () => {
  expect(ProxiedPhoto.loading(proxied)).toBe(true);
  expect(ProxiedPhoto.loading(ProxiedPhoto.next(proxied, "load"))).toBe(false);
  expect(ProxiedPhoto.loading({ kind: "failed" })).toBe(false);
});
