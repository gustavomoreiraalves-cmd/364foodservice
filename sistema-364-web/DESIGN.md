---
name: Sistema 364
description: A dark, ledger-precise control room for a multi-brand foodservice operation.
colors:
  char: "#1c1815"
  char-2: "#252019"
  char-3: "#2f2921"
  smoke: "#3c352b"
  paper: "#f4efe6"
  paper-dim: "#c9c0af"
  amber: "#c68a2e"
  amber-bright: "#e0a949"
  ember-red: "#a13d2b"
  coral-alert: "#e5806c"
  field-green: "#8fbd6f"
  border: "#413a2f"
typography:
  display:
    fontFamily: "Georgia, 'Times New Roman', serif"
    fontSize: "22px–64px (contextual: topbar h1 to quiosque clock)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.3px"
  title:
    fontFamily: "Georgia, 'Times New Roman', serif"
    fontSize: "14px"
    fontWeight: 400
    letterSpacing: "0.8px"
  body:
    fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "12.5px–14px"
    fontWeight: 400
    lineHeight: "normal"
  label:
    fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "10.5px–11.5px"
    fontWeight: 400
    letterSpacing: "0.5px–1.5px"
    textTransform: "uppercase"
rounded:
  sm: "3px"
  lg: "8px"
  xl: "10px"
  pill: "20px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "26px"
components:
  button-primary:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.char}"
    rounded: "{rounded.sm}"
    padding: "9px 16px"
  button-primary-hover:
    backgroundColor: "{colors.amber-bright}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.paper-dim}"
    rounded: "{rounded.sm}"
    padding: "9px 16px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.coral-alert}"
    rounded: "{rounded.sm}"
    padding: "5px 9px"
  card:
    backgroundColor: "{colors.char-2}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "18px 20px"
  input:
    backgroundColor: "{colors.char}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "8px 9px"
---

# Design System: Sistema 364

## Overview

**Creative North Star: "The Foreman's Board"**

Sistema 364 is the shift lead's board on the wall of a working kitchen: dark, no-nonsense, built to be scanned at a glance while hands are busy with something else. It exists to track lots, costs, shifts, and stock across four brands sharing one back office — precision under pressure, not persuasion. Every screen defaults to dense, tabular, low-glare: charcoal surfaces, paper-colored text, and a single warm amber signal for what needs a hand on it right now.

The palette is deliberately narrow — a handful of char/smoke tones, one paper text color, one recurring accent — so that amber reading as "active, primary, or worth noticing" never has to compete with decorative color elsewhere. The system rejects light backgrounds, drop shadows, and rounded-corner softness as its default register; those belong only to the one sub-world built for a different physical context (the ponto kiosk touchscreen, see below).

**Key Characteristics:**
- Dark charcoal ground with a single warm amber signal, not a multi-color palette.
- Georgia serif reserved for numbers and headings; everything operational reads in a plain UI sans-serif.
- Uppercase, letter-spaced micro-labels used relentlessly as the connective tissue between data points.
- Flat by default — depth comes from tone steps and hairline borders, never shadows.
- Sharp 3px corners on desktop/office screens; a distinct, larger-radius, big-touch-target language on the tablet kiosk.

## Colors

A near-monochrome charcoal system lit by one recurring amber signal, with narrow, purpose-built reds and one untokenized green for state.

### Primary
- **Amber** (`#c68a2e`): the system's one recurring accent — primary button fill, active nav/tab state, KPI accent border, focus outline, links. Used deliberately often; its repetition across active/primary/attention states *is* the system's signature warmth, not overuse.
- **Amber Bright** (`#e0a949`): the amber's hover/active step and the color of "amber on dark" text (panel headings, active nav labels, KPI numerals that need to pop).

### Neutral
- **Char** (`#1c1815`): the base ground — page background, input fields, the kiosk's dark core.
- **Char 2** (`#252019`): the first surface step up — cards, panels, KPI tiles.
- **Char 3** (`#2f2921`): the second surface step — hover backgrounds, sidebar link hover, kiosk secondary surfaces.
- **Smoke** (`#3c352b`): the "selected/active" surface — active sidebar item, active ponto-tab, selected kiosk type.
- **Paper** (`#f4efe6`): primary text on dark surfaces.
- **Paper Dim** (`#c9c0af`): secondary/muted text — labels, descriptions, table headers, placeholder-weight copy.
- **Border** (`#413a2f`): the one hairline border color used everywhere a division is needed — cards, inputs, table rules, dividers.

### Functional
- **Ember Red** (`#a13d2b`): structural danger — the KPI warning accent border, the danger button's border and hover fill. Deep and used sparingly, as a border/fill rather than large surface.
- **Coral Alert** (`#e5806c`): bright alert text — danger button label, "bad" status tag text, kiosk error copy, off-line status dot. Paired with Ember Red but reserved for text/small marks, never a fill.
- **Field Green** (`#8fbd6f`) on `#28351f`: the success pairing — "ok" status tags, online status dot, kiosk check-in confirmation. Real and reused three times in the codebase but not yet promoted to a CSS custom property; treat it as canonical the next time a `--green` token is wired up.

### Named Rules
**The One Signal Rule.** Amber is the only accent color allowed to mean "primary, active, or pay attention." Every other color in the system is either structural neutral (char/smoke/paper) or a narrow functional state (danger/success). Don't introduce a second decorative accent color.

## Typography

**Display Font:** Georgia, with 'Times New Roman' and serif fallback
**Body Font:** 'Segoe UI', with Roboto, Helvetica, Arial, sans-serif fallback

**Character:** A working ledger's pairing — a plain, high-legibility UI sans for the operational grind (tables, forms, labels), and an old-style serif reserved for numbers and identity, so the moments that matter (a KPI value, the brand mark, a clock) read with more weight and craft than the surrounding chrome.

### Hierarchy
- **Display** (400, 22px topbar title up to 64px kiosk clock, line-height 1): brand mark, page titles, KPI values, kiosk clock and confirmation names. Georgia's the "this number/name matters" signal.
- **Title** (400, 14px, letter-spacing 0.8px, uppercase-by-context): panel section headers in amber-bright — a serif label, not a heading in the display sense.
- **Body** (400, 12.5–14px): table cells, form copy, descriptions, running text.
- **Label** (400, 10.5–11.5px, letter-spacing 0.5–1.5px, uppercase, paper-dim): the system's connective tissue — KPI labels, form field labels, table column headers, sidebar sub-brand, tag text. This is the single most repeated typographic move in the system.

### Named Rules
**The Serif-For-Numbers Rule.** Georgia appears only on headings, brand marks, and numeric/identity display values — never on body copy, labels, or table cells. If it's data being scanned in bulk, it's sans-serif; if it's a headline number or a name, it's serif.

## Layout

Sistema 364 runs in two distinct physical contexts sharing one token system:

- **Office shell** (desktop/tablet browser): a fixed 210px sidebar (nav + company switcher + user badge) and a fluid main column padded 26px 34px. KPI tiles lay out on `repeat(auto-fit, minmax(190px, 1fr))` with 12px gaps; two-panel comparisons use a `1fr 1fr` grid at 20px gap. Below 900px the sidebar drops above the content and stacks full-width, and two-column grids collapse to one.
- **Kiosk shell** (`/quiosque`, tablet fullscreen, no sidebar): a single centered column on a radial-gradient charcoal background, built for a person standing at arm's length from a mounted tablet — oversized touch targets, a giant PIN input, and a live camera preview for facial check-in.

Forms use `repeat(auto-fit, minmax(160px, 1fr))` field grids aligned to the field baseline (`align-items: end`), so labels and inputs of different heights stay visually level.

## Elevation & Depth

Flat by design — there is no `box-shadow` anywhere in the system. Depth is conveyed entirely through tonal steps (char → char-2 → char-3 → smoke) and 1px borders, never through cast shadows.

### Named Rules
**The Flat-By-Default Rule.** Surfaces never cast a shadow, at rest or on hover. A card sits "above" the page only because it's a lighter tone step with a border, not because it's lifted.

## Shapes

Two form languages, split by physical context:

- **Office shell:** a near-sharp 3px radius (`--radius`) on nearly everything — cards, panels, inputs, buttons. Status tags are the one full-pill exception (20px radius), and the print "ficha" drops radius entirely (square-cornered, table-ruled, made to be read on paper).
- **Kiosk shell:** a softer, larger radius — 8px on secondary controls and the giant register button, 10px on primary containers (video frame, confirmation card, comprovante) — because these are big touch targets for a thumb, not a mouse pointer.

## Components

### Buttons
- **Shape:** 3px radius, built on a `all: unset` reset so no browser button chrome leaks through.
- **Primary:** amber fill, char-dark text (`#1c1815`), bold weight, uppercase-leaning letter-spacing (0.5px), 9px 16px padding.
- **Hover / Disabled:** hover steps to amber-bright; disabled drops to 0.5 opacity with a default cursor, no other state change.
- **Secondary:** transparent fill, bordered in `--border`, paper-dim text; hover swaps the border and text to amber/amber-bright.
- **Danger:** transparent fill, ember-red border, coral-alert text, tighter padding (5px 9px); hover fills solid ember-red with paper text.
- **Small:** same variants at 5px 9px padding, 11px type — used for row-level actions.

### Tags / Status Pills
- **Shape:** full pill (20px radius), 2px 8px padding, 10.5px uppercase label.
- **States:** `ok` (field-green on dark green), `warn` (amber-bright on dark amber-brown), `bad` (coral-alert on dark red-brown) — always a saturated text color on its own muted, near-black tint of the same hue.

### Cards / Panels
- **Corner Style:** 3px radius.
- **Background:** char-2, one step lighter than the page.
- **Border:** 1px `--border` on all sides.
- **KPI variant:** adds a 3px left accent border in amber (ember-red when the metric is in a warning state) — the one place a side-accent border is used deliberately, not decoratively.
- **Panel variant:** an amber-bright uppercase title with a border-bottom rule separates the header from its content.

### Inputs / Fields
- **Style:** char background, 1px `--border`, 3px radius, inherited font.
- **Focus:** border color shifts to amber — no glow, no ring, just a color-only state change.
- **Kiosk input:** a distinct oversized variant — 28px type, 8px letter-spacing, center-aligned, for PIN-style entry at arm's length.

### Tables
- No cell borders except a 1px bottom rule per row; header cells are uppercase, letter-spaced, paper-dim.
- Row hover darkens the row (`#241f19`) rather than lifting it.
- Numeric columns get `font-variant-numeric: tabular-nums` and right-alignment via `.num`.
- Empty state: a single centered, italic, paper-dim row rather than an empty table.

### Navigation
- **Sidebar:** paper-dim links by default; hover moves to char-3 background with paper text; the active route gets a smoke background, amber-bright text, and bold weight.
- **Ponto sub-tabs:** the same active-state logic (smoke background, amber-bright text) applied to a horizontal pill row instead of a vertical list, so sub-navigation reads as a sibling pattern to the main sidebar rather than a new idiom.

### Kiosk (signature sub-world)
A fullscreen, radial-gradient tablet mode outside the office shell entirely: a large Georgia clock, a giant amber "register" button (8px radius, 22px 54px padding), a mirrored live camera frame for facial capture, and big selectable tiles for marking type (10px radius, amber border + smoke fill when selected). Confirmation renders as a green-tinted receipt card with monospace detail lines — the one place the system uses a monospace font, to read as a printed stub rather than a UI panel.

### Print Ficha (signature sub-world)
A second, separate world that only exists inside `@media print`: black-on-white, Georgia serif throughout, a double-ruled header border, and a fully-gridded form table with 1px black rules — built to be read as a physical printed receipt/ficha, not a screen. It intentionally shares no tokens with the dark office/kiosk system.

## Do's and Don'ts

### Do:
- **Do** keep amber as the only color that means "primary, active, or attention" — its frequent reuse across nav/buttons/KPIs/focus is the system's signature, not a bug to fix.
- **Do** pair every dark surface step with a 1px `--border` rather than a shadow to signal a boundary.
- **Do** use the uppercase, letter-spaced Label style for anything that annotates data (field labels, table headers, KPI labels, tag text) rather than inventing a new caption style.
- **Do** use Georgia only for numbers, headings, and identity marks — never for body copy or labels.
- **Do** give the kiosk shell its own larger radius and touch-target scale rather than reusing office-shell 3px controls at tablet size.

### Don't:
- **Don't** add `box-shadow` anywhere in the office or kiosk shell — depth is tone-step + border only.
- **Don't** introduce a second decorative accent color alongside amber; new semantic states should draw from the existing danger/success pairs (ember-red/coral-alert, field-green) before adding a new hue.
- **Don't** carry the kiosk's larger radius (8–10px) or oversized touch targets into the office shell, or the office shell's 3px sharpness into the kiosk — they're deliberately different form languages for different physical contexts.
- **Don't** mix the print ficha's black-on-white paper world with the dark office/kiosk token set; it's an intentionally separate visual register for a printed artifact.
