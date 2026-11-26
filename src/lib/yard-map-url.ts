import type { YardMapView } from "./yard-map-projection";

/**
 * The yard map's place in the page URL, so Back and shared links return to
 * the same view and yard. `at` is `lat,lng,zoom`; `yard` is a yard key
 * (`source:code`). Anything malformed reads as absent, which shows the
 * overview, and other query parameters are left alone.
 */
const VIEW = "at";
const YARD = "yard";

function update(search: string, name: string, value: string | null): string {
  const params = new URLSearchParams(search);
  if (value === null) params.delete(name);
  else params.set(name, value);
  const next = params.toString();
  return next ? `?${next}` : "";
}

function view(search: string): YardMapView | null {
  const value = new URLSearchParams(search).get(VIEW);
  const parts = value?.split(",") ?? [];
  if (parts.length !== 3 || parts.some((part) => part.trim() === "")) {
    return null;
  }
  const [lat, lng, zoom] = parts.map(Number);
  if (
    lat === undefined ||
    lng === undefined ||
    zoom === undefined ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !Number.isFinite(zoom) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180 ||
    zoom < 1 ||
    zoom > 18
  ) {
    return null;
  }
  return { center: [lat, lng], zoom };
}

function withView(search: string, next: YardMapView | null): string {
  if (!next) return update(search, VIEW, null);
  // Five decimals is about a meter; finer only churns the URL while panning.
  const round = (value: number, digits: number) =>
    String(Number(value.toFixed(digits)));
  return update(
    search,
    VIEW,
    `${round(next.center[0], 5)},${round(next.center[1], 5)},${round(next.zoom, 2)}`,
  );
}

function yard(search: string): string | null {
  return new URLSearchParams(search).get(YARD) || null;
}

function withYard(search: string, key: string | null): string {
  return update(search, YARD, key);
}

/** Replace the current history entry's query without a navigation. */
function replace(edit: (search: string) => string): void {
  const { pathname, search, hash } = window.location;
  const next = edit(search);
  if (next === search) return;
  // Next.js keeps its router state when the first argument is null.
  window.history.replaceState(null, "", `${pathname}${next}${hash}`);
}

type LinkClick = Pick<
  MouseEvent,
  "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>;

/**
 * Whether a click on `link` navigates this tab to another page. Writing the
 * URL while that navigation loads would cancel it: Next.js treats
 * `history.replaceState` as restoring the current page.
 */
function leavesPage(
  click: LinkClick,
  link: { href: string; target: string; download: boolean } | null,
  current: string,
): boolean {
  if (
    !link ||
    click.button !== 0 ||
    click.metaKey ||
    click.ctrlKey ||
    click.shiftKey ||
    click.altKey ||
    link.download ||
    (link.target !== "" && link.target !== "_self")
  ) {
    return false;
  }
  // Not URL.parse: Safari before 18 lacks it.
  let destination: URL;
  let here: URL;
  try {
    here = new URL(current);
    destination = new URL(link.href, here);
  } catch {
    return false;
  }
  if (destination.protocol !== "http:" && destination.protocol !== "https:") {
    return false;
  }
  return (
    destination.origin !== here.origin ||
    destination.pathname !== here.pathname ||
    destination.search !== here.search
  );
}

export const YardMapUrl = {
  view,
  withView,
  yard,
  withYard,
  replace,
  leavesPage,
} as const;
