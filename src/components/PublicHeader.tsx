import { HeaderContent } from "./HeaderContent";

/**
 * The site header for pages served from the CDN. It reads nothing from the
 * request, so it doesn't force dynamic rendering, and it leaves out the
 * provider status banner, whose five-minute cache would cap the page's.
 */
export function PublicHeader() {
  return <HeaderContent auth={{ kind: "client" }} />;
}
