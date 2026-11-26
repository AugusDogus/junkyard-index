# Design: Junkyard Index

The locked system. Every Hallmark run reads this first and pages share it. Change it on purpose; the file is the rule.

## System

- Genre: quiet terminal, after backplaneworks.com: warm green-black night, off-white primary, 1px rules, square corners, one mono face in two weights
- Shape of the first page: kept (search over the yard map, the arrivals board, FAQ rows, plan plates, the close); the inventory pages are Index pages under a Banner head
- Theme: night in dark (`.dark`, next-themes) and a derived warm paper day theme in light
- Axes: dark-first/mono/warm · posture: quiet

## Tokens

`src/styles/tokens.css` is the source of truth; `src/styles/globals.css` points shadcn's names at it. shadcn owns `--color-muted` and `--color-accent`, so the muted ink is `--color-ink-3` and the site accent is `--color-signal`:

```css
.dark {
  --color-paper: #111410; /* page */
  --color-paper-2: #1a1e18; /* hover and second surface */
  --color-paper-3: #151914; /* cards, fields */
  --color-ink: #e6e9de;
  --color-ink-2: #c3c9b8;
  --color-ink-3: #969d90;
  --color-rule: #2c3229; /* hairline: cards, dividers */
  --color-rule-strong: #646b5f; /* controls, section rules: 3:1 on every surface */
  --color-signal: #d6edaf; /* accent: focus, live marks, link hover */
  --color-signal-fill: #e6e9de; /* primary button */
  --color-signal-fill-hover: #ffffff;
  --color-signal-ink: #111410;
  --color-figure: #d6edaf; /* figures on the board */
  --color-board: #181c16;
}
:root {
  /* day: paper #f2f3ed, ink #111410, rule #d5d9cd, rule-strong #7a8173,
     signal #4a6a1d, signal-fill #111410; the board stays dark */
}
```

Font: Ioskeley Mono (SIL OFL 1.1, an Iosevka build after Berkeley Mono), Regular 400 and Medium 500, subset woff2 in `src/fonts/ioskeley-mono/` with its license. `src/app/fonts.ts` is the one place the face is named (`--font-brand`). Headings are 500 with tight tracking (`--tracking-display: -0.045em`); `strong` and `th` are 500. No other weights.

Utilities: `bg-paper`, `text-ink-3`, `border-rule`, `border-rule-strong`, `bg-board`, `text-figure`, `text-signal`; sizes `text-display`, `text-display-s`, `text-section`, `text-title`, `text-lead`. Tailwind's own `text-xs` to `text-3xl` stay Tailwind's so the app screens keep their sizes. The board (`bg-board`) is a dark plate in both themes; figure-coloured text appears only on it.

## Canvas

- One container: `.shell` (1440px cap, gutters 64/24/16px). Header, every public page and the footer use it.
- Headings carry their size as a utility (`text-section` for section heads, `text-title` for item titles); base.css sets only the face, weight 500 and tracking.

## Controls

- Every rule is 1px. Frames of controls use `border-rule-strong`; cards and dividers may use the hairline `border-rule`.
- Primary: shadcn `Button` default, the off-white plate with dark text at night (ink plate with paper text by day), hover lifts to white; `size="xl"` is 48px for public pages, header controls 44px. On the board, the primary is `bg-board-ink` in both themes.
- Secondary: `variant="outline"`, transparent with a 1px `rule-strong` border; hover turns the border to ink, never a fill.
- Search: field and button share one 48px row, one frame and one focus ring (`SearchField`).
- Choice sets: square cells sharing 1px borders; the chosen cell fills ink with paper text.
- Links: ink, underlined, the accent on hover; focus is a 2px outline in `--color-focus` offset 3px.

## Motion

- Character: quiet. Colour changes step (`board-step` utility: `steps(1)`). Two things move: the arrivals carousel, and the light circling the featured (Lite) plan's frame. Both pause off-screen and stop under reduced motion.

## Do-nots

- No proportional face, no third weight, no 2px rules, no rounded cards, no soft shadows on cards, no gradient fills, no figure-coloured text on paper (on paper it appears only as the filled flag behind dark text on late listings).
- No middle-dot meta strings, no tracked capitals, no eyebrows, no card inside a card.

## Exports

`src/styles/tokens.css` (Tailwind v4 `@theme static`) and the shadcn mapping in `src/styles/globals.css`.
