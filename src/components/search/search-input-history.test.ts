import { afterEach, beforeEach, expect, test } from "bun:test";
import { SearchInputHistory } from "./search-input-history";

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const browser = { location: new URL("https://example.com/search?q=toyota") };
beforeEach(() => {
  browser.location = new URL("https://example.com/search?q=toyota");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browser,
  });
  SearchInputHistory.cancel();
});
afterEach(() => {
  if (previousWindow)
    Object.defineProperty(globalThis, "window", previousWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

const never = () => false;

test("a canonical rewrite of a navigated URL replaces its entry", () => {
  expect(
    SearchInputHistory.write({
      onlyQuery: false,
      sameResults: true,
      isWritten: never,
    }),
  ).toEqual({ history: "replace" });
});

test("a different search adds an entry", () => {
  expect(
    SearchInputHistory.write({
      onlyQuery: false,
      sameResults: false,
      isWritten: never,
    }),
  ).toEqual({ history: "push" });
});

test("typing replaces until another change, which pushes and ends the draft", () => {
  SearchInputHistory.begin();
  const typing = { onlyQuery: true, sameResults: false, isWritten: never };
  expect(SearchInputHistory.write(typing)).toEqual({ history: "replace" });
  expect(SearchInputHistory.write(typing)).toEqual({ history: "replace" });
  expect(SearchInputHistory.write({ ...typing, onlyQuery: false })).toEqual({
    history: "push",
  });
  // The draft ended, so the next query edit is its own entry.
  expect(SearchInputHistory.write(typing)).toEqual({ history: "push" });
});

test("a submit pushes once, restoring the URL from before typing", () => {
  SearchInputHistory.begin();
  browser.location = new URL("https://example.com/search?q=toyota+v");
  SearchInputHistory.submit();
  expect(
    SearchInputHistory.write({
      onlyQuery: true,
      sameResults: false,
      isWritten: never,
    }),
  ).toEqual({
    history: "push",
    previous: "https://example.com/search?q=toyota",
  });
  expect(SearchInputHistory.submitShown(never)).toBeNull();
});

test("submitting a live preview checkpoints it unless nothing changed", () => {
  SearchInputHistory.begin();
  expect(SearchInputHistory.submitShown(never)).toEqual({
    history: "push",
    previous: "https://example.com/search?q=toyota",
  });
  SearchInputHistory.begin();
  expect(SearchInputHistory.submitShown(() => true)).toEqual({
    history: "replace",
  });
  expect(SearchInputHistory.submitShown(never)).toBeNull();
});
