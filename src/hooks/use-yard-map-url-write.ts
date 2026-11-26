import { useEffect, useRef } from "react";
import { YardMapUrl } from "~/lib/yard-map-url";

/**
 * Keep part of the map's state in the URL with `edit`, a stable callback
 * that changes when the state does. The write waits 250ms for the map to
 * settle. A click on a link that leaves the page writes at once, so Back
 * returns to the latest view, and then stops writing: a `replaceState`
 * while the next page loads would cancel that navigation.
 */
export function useYardMapUrlWrite(edit: (search: string) => string): void {
  const leaving = useRef(false);
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      const target = link && {
        href: link.href,
        target: link.target,
        download: link.hasAttribute("download"),
      };
      if (!YardMapUrl.leavesPage(event, target, window.location.href)) return;
      pending.current?.();
      leaving.current = true;
    };
    // Capture runs before Next.js's link handler starts the navigation.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (leaving.current) return;
    const { pathname } = window.location;
    const write = () => {
      pending.current = null;
      // A Back or Forward to another page also leaves this one.
      if (!leaving.current && window.location.pathname === pathname) {
        YardMapUrl.replace(edit);
      }
    };
    pending.current = write;
    const timeout = window.setTimeout(write, 250);
    return () => {
      window.clearTimeout(timeout);
      if (pending.current === write) pending.current = null;
    };
  }, [edit]);
}
