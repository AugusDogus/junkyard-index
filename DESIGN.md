# Design: Junkyard Index

The locked system. Every Hallmark run reads this first and pages share it. Change it on purpose; the file is the rule.

## System

- Genre: modern-minimal
- Shape of the first page: kept (search over the yard map, the arrivals board, FAQ rows, plan plates, the cobalt close); the inventory pages are Index pages under a Banner head
- Theme: Wayfind, platform colourway in light and night in dark (`.dark`, next-themes)
- Axes: light/mono/cool · posture: committed

## Tokens

`src/styles/tokens.css` is the source of truth; `src/styles/globals.css` points shadcn's names at it. Wayfind's muted ink, cobalt and amber are renamed because shadcn owns `--color-muted` and `--color-accent`:

```css
:root {
  --color-paper: oklch(95.5% 0.006 250);
  --color-paper-2: oklch(91% 0.009 250);
  --color-paper-3: oklch(99.5% 0.005 250);
  --color-ink: oklch(16% 0.014 262);
  --color-ink-2: oklch(29% 0.014 262);
  --color-ink-3: oklch(47% 0.016 260);
  --color-rule: oklch(80% 0.011 250);
  --color-signal: oklch(51% 0.22 264);
  --color-signal-fill: oklch(51% 0.22 264);
  --color-signal-ink: oklch(99.5% 0.003 250);
  --color-focus: oklch(51% 0.22 264);
  --color-figure: oklch(81% 0.16 82); /* amber: figures on the board only */
  --color-board: oklch(16% 0.014 262);
  --color-board-2: oklch(22% 0.014 262);
  --color-board-ink: oklch(95.5% 0.006 250);
  --color-board-muted: oklch(76% 0.012 255);
  --color-board-rule: oklch(34% 0.014 262);
  --font-display:
    Chivo Mono (next/font, --font-chivo-mono), ui-monospace, monospace;
  --font-body: var(--font-display);
  --radius-card: 0;
  --radius-pill: 999px;
  --rule-hair: 1px;
  --rule-bar: 2px;
  --shadow-card: only under a surface floating over another;
}
```

Utilities: `bg-paper`, `text-ink-3`, `border-ink`, `bg-board`, `text-figure`, `text-signal`, `bg-signal-fill`; sizes `text-display`, `text-display-s`, `text-section`, `text-title`, `text-lead`. Tailwind's own `text-xs` to `text-3xl` stay Tailwind's so the app screens keep their sizes. The board (`bg-board`) is the ink plate: dark on the light page, a raised 24% plate on the night page, never light; amber (`text-figure`) appears only on it.

## Canvas

- One container: `.shell` (1440px cap, gutters 64/24/16px). Header, every public page and the footer use it.
- Headings carry their size as a utility (`text-section` for section heads, `text-title` for item titles); base.css sets only the face, weight 800 and tracking.

## Controls

- Primary: shadcn `Button` default, cobalt fill, 2px border, square, Chivo Mono 800; `size="xl"` is 48px for public pages, header controls 44px.
- Secondary: `variant="outline"`, a 2px ink border, transparent, the same height; on the board or the cobalt field, swap to the board or signal ink tokens.
- Choice sets: square cells sharing 2px ink borders; the chosen cell fills ink with paper text.
- Links: ink, underlined, cobalt on hover; focus is a 2px outline in `--color-focus` (amber `outline-figure` on the board).

## Motion

- Character: severe. Colour changes step (`board-step` utility: `steps(1)`), no reveals, no lifts; the arrivals carousel is the only movement and it pauses on hover, focus, off-screen and under reduced motion.

## Do-nots

- No proportional face, no rounded cards, no soft shadows on cards, no gradient, no amber text on paper, no third bright colour.
- No middle-dot meta strings, no tracked capitals, no eyebrows, no card inside a card.

## Exports

`src/styles/tokens.css` (Tailwind v4 `@theme static`) and the shadcn mapping in `src/styles/globals.css`.
