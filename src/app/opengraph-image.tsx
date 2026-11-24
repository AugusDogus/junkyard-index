import { ImageResponse } from "next/og";
import { SITE_IMAGE } from "~/lib/site-metadata";

// Rendered once at build time and served as a static file, in next/og's
// bundled Noto Sans: loading Chivo Mono would mean vendoring its font files.
export const alt = SITE_IMAGE.alt;
export const size = { width: SITE_IMAGE.width, height: SITE_IMAGE.height };
export const contentType = "image/png";

// Wayfind's board, ink, signal and figure tokens (src/styles/tokens.css) in hex.
const BOARD = "#14171d";
const BOARD_INK = "#eef0f3";
const BOARD_MUTED = "#b4b9c1";
const SIGNAL = "#2e55e6";
const FIGURE = "#f0b52a";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        background: BOARD,
        color: BOARD_INK,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <svg
          width="88"
          height="88"
          viewBox="0 0 24 24"
          fill="none"
          stroke={FIGURE}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8" />
          <path d="M7 14h.01" />
          <path d="M17 14h.01" />
          <rect width="18" height="8" x="3" y="10" rx="2" />
          <path d="M5 18v2" />
          <path d="M19 18v2" />
        </svg>
        <div style={{ fontSize: 56 }}>Junkyard Index</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ fontSize: 68, lineHeight: 1.05 }}>
          Search salvage yard inventory in one place.
        </div>
        <div style={{ fontSize: 32, color: BOARD_MUTED }}>
          Live donor vehicles by yard, make and model, updated daily.
        </div>
      </div>
      <div
        style={{ display: "flex", height: 8, width: 240, background: SIGNAL }}
      />
    </div>,
    size,
  );
}
