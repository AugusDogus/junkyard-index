import localFont from "next/font/local";

/**
 * The site's one typeface, the only place it is named. Every glyph is set in
 * it through --font-brand (src/styles/tokens.css); to change the face, swap
 * the files here and keep the variable.
 *
 * Ioskeley Mono v2.2.0 (github.com/ahatem/IoskeleyMono, SIL OFL 1.1, license
 * beside the files), an Iosevka build drawn after Berkeley Mono. The files
 * are subset to Latin, Latin-1, Latin Extended-A, punctuation and arrows.
 *
 * The site uses two weights, as backplaneworks.com does: 400 for text, 500
 * for headings, labels and emphasis (base.css maps strong and th to 500).
 * next/font preloads every file of a family, so the family holds only these
 * two; a bold or italic file here would be downloaded on every page.
 */
export const brandFont = localFont({
  src: [
    {
      path: "../fonts/ioskeley-mono/IoskeleyMono-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/ioskeley-mono/IoskeleyMono-Medium.woff2",
      weight: "500",
      style: "normal",
    },
  ],
  variable: "--font-brand",
  display: "swap",
  fallback: ["ui-monospace", "monospace"],
});
