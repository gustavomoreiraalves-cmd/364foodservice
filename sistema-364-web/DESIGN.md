---
name: Sistema 364
description: A light working surface where panels persist, seams replace shadow, and one mint green carries the brand as fill — never as ink.
colors:
  ground: "#f2f4f6"
  panel: "#ffffff"
  sunken: "#f7f8fa"
  seam: "#dfe3e8"
  seam-strong: "#c4ccd5"
  ink: "#11161c"
  ink-2: "#3d4854"
  ink-muted: "#626d7a"
  ink-faint: "#6b7683"
  mint: "#75fc96"
  mint-hover: "#57f581"
  mint-wash: "#e9fdef"
  green-deep: "#0f6b39"
  accent-ink: "#08120c"
  ok: "#1257b8"
  ok-wash: "#eaf2fe"
  warn: "#8a6100"
  warn-wash: "#fdf5e2"
  danger: "#d13817"
  danger-ink: "#c23214"
  danger-wash: "#fdece8"
typography:
  display:
    fontFamily: "Manrope, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Manrope, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
  label:
    fontFamily: "Manrope, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 500
  section:
    fontFamily: "Manrope, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "10.5px"
    fontWeight: 600
    letterSpacing: "0.09em"
    textTransform: "uppercase"
  measured:
    fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "11.5px–23px"
    fontWeight: 400
    fontVariantNumeric: "tabular-nums"
rounded:
  sm: "8px"
  lg: "14px"
  pill: "20px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "26px"
components:
  button-primary:
    backgroundColor: "{colors.mint}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.sm}"
    padding: "9px 16px"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-2}"
    borderColor: "{colors.seam-strong}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  button-danger:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.danger}"
    borderStyle: "dashed"
    rounded: "{rounded.sm}"
    padding: "5px 9px"
  panel:
    backgroundColor: "{colors.panel}"
    borderColor: "{colors.seam}"
    rounded: "{rounded.lg}"
    padding: "20px 22px"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    borderColor: "{colors.seam-strong}"
    rounded: "{rounded.sm}"
    padding: "7px 9px"
  record-row:
    backgroundColor: "{colors.panel}"
    selectedBackgroundColor: "{colors.accent-wash}"
    borderColor: "{colors.seam}"
    padding: "9px 12px"
---

# Design System: Sistema 364

## Overview

**Creative North Star: "The Working Surface"**

Sistema 364 is a bench, not a dashboard. Panels are laid out and they stay laid
out; what changes is the content inside them. A list of products on the left, the
open record on the right, and neither one goes away when the other is used. The
whole surface is white paper on a light grey floor, divided by 1px seams — there
is no shadow anywhere except the one modal that genuinely floats.

The rule that shapes everything: **color only ever means state**. Blue is the
action and the current selection. Green is checked. Amber is pending. Red is
destructive and always stands apart from its neighbours. Nothing in this system
is colored to be pretty, so when something is colored the operator can trust that
it is telling them something.

Numbers are never set in the interface face. Anything measured — a product code,
a quantity, money, a tax rate, a version string — is monospaced and tabular, so
that the column of costs down a list reads as a column and the eye can compare
without stopping.

**Key characteristics:**
- White panels on a light grey ground, separated by a single 1px seam weight.
- Flat by construction: no shadows, no gradients, no colored left borders.
- Lexend for the interface, JetBrains Mono for everything measured.
- Section titles inside forms, not cards inside cards.
- The destructive action is separated from its neighbours by space, not by warning copy.

## Colors

### Surface
- **Ground** (`#f2f4f6`): the floor the panels sit on. Never carries content directly.
- **Panel** (`#ffffff`): every working surface — panels, inputs, list rows, the sidebar.
- **Sunken** (`#f7f8fa`): hover state, table headers, the tray a list of sub-items sits in.
- **Seam** (`#dfe3e8`) and **Seam Strong** (`#c4ccd5`): the only two division weights. Seam divides content from content; Seam Strong outlines something you can type into or click.

### Ink
- **Ink** (`#11161c`): body and headings, 18.2:1 on panel.
- **Ink 2** (`#3d4854`): field labels and secondary values, 9.3:1.
- **Ink Muted** (`#626d7a`): descriptions, counts, section titles. 5.3:1 on panel and 4.8:1 on ground — it had to be darkened from a lighter grey that failed on the ground.
- **Ink Faint** (`#6b7683`): placeholders and resting icons, 4.6:1. Nothing lighter than this carries text.

### Brand and action — the mint family
The brand color is **Mint** (`#75fc96`), and it exists in three tones because one
is not enough. Mint measures **1.3:1 against white**: as ink, as a hairline, or as
a focus ring it is invisible. Confusing the three is how a screen becomes
unreadable without anyone noticing.

- **Mint** (`#75fc96`): fill only, always under **Accent Ink** (`#08120c`) — 14.6:1. Primary buttons, product category tags, the 3px selection seam, chart bars.
- **Mint Wash** (`#e9fdef`): the selected row, the active area.
- **Green Deep** (`#0f6b39`): everything thin — links, active tab and nav labels, focus ring, input focus border, sparkline stroke. 6.6:1 on white.

### State
- **OK** (`#1257b8`) on **OK Wash** (`#eaf2fe`): checked, complete, released. It became blue when green became the brand — one color, one meaning.
- **Warn** (`#8a6100`) on **Warn Wash** (`#fdf5e2`): pending — a record that cannot be used yet, and the count of what is missing.
- **Danger** (`#d13817`) fills and outlines; **Danger Ink** (`#c23214`) is the text tone, because the fill color reads 4.28:1 on its own wash and the ink reads 4.88:1.

### Named rules
**Color is a claim.** Green is the brand and the action; blue means a person
checked it; amber means incomplete; red destroys or is wrong. A color used for
emphasis alone breaks the only reason the operator trusts the other three.

**Mint never carries meaning alone.** The selected row has a mint seam, but what
carries the state is the washed background plus `aria-selected`. The active tab
has a mint underline, but the label also turns Green Deep and gains weight. Any
state that mint marks is marked twice.

**Every list searches, and search forgives.** The search box strips accents and
case, and a term made of digits also matches the digits of a document — someone
reading a CNPJ off a printed invoice types the dots and slashes they see.
`lib/listaCadastro.js` holds it, so all three screens forgive the same way.

**Tax rules are reachable from where the work happens.** A product's tax
configuration is a shared entity — that is what stops CFOP and MVA from being
retyped per SKU — but it is created and corrected from inside the product's
Fiscal tab, in a modal, with the rules it already carries listed underneath the
selector. Sending someone to a separate menu to describe how an item is taxed is
how the separate menu becomes the thing nobody understands.

**Mint fill has two jobs, and they do not compete.** It is the primary action,
and it is the product's category tag — a tag is a label the eye groups by while
scanning, never something to click. They coexist because they never sit in the
same place: actions live in the toolbar and the panel foot, category tags live
inside a list row. Nothing else earns the mint fill.

**Never a colored border above 1px.** Depth is tone and seam. The one exception
is the 2px seam on the left edge of a selected list row, which is selection state
and not decoration.

## Typography

**Interface:** Manrope (400/500/600/700), self-hosted through next/font.
**Measured:** JetBrains Mono (400/500), tabular figures.

### Hierarchy
- **Page title** (600, 19px, -0.01em): one per screen, in the sticky top bar.
- **Record title** (600, 15px): the open record's name in the panel head.
- **Body** (400, 13.5px): the default.
- **Label** (500, 11px): field labels, in Ink 2. Not uppercase — uppercase belongs to sections.
- **Section** (600, 10.5px, 0.09em, uppercase, Ink Muted): the divider inside a form, with a hairline running from the text to the right edge.
- **Measured** (mono, tabular): codes, quantities, money, rates, dates, version strings, KPI values.

### Named rules
**The mono-for-measured rule.** If the value would be compared against another
value of the same kind, or typed from a document, it is monospaced. Names,
descriptions and copy never are — monospace here is for alignment and
transcription, not for looking technical.

## Layout

**Office shell:** a 224px sidebar (brand, company switcher, grouped nav, user
foot) and a fluid main column. The top bar is sticky and carries the page title.

**The bench** (`.workbench`): two equal columns, `minmax(360px,1fr)` each, with
the record panel sticky under the top bar. Below 1100px it collapses to a single
`minmax(0,1fr)` column — the `minmax(0,…)` matters, because a plain `1fr`
respects the list's min-content and pushes the panel off the screen.

**Forms:** `repeat(auto-fit, minmax(180px, 1fr))`, aligned to the top so help
text under one field does not shift its neighbour. `.largo` spans the full row.
Sections divide with `.secao`.

**Records:** rows carry code, name, category tag, NCM, cost, price, margin and
fiscal status. `.registro-lista` opens with `.registro-cabecalho`, a sunken strip
naming every column — three money-shaped numbers in a row say nothing about which
is cost, which is price, and what the percentage measures. Header and row share
fixed column widths, never `min-width`: with a minimum, a value wider than its
label pushes the next column and the drift accumulates left to right. The
selection seam is 3px and always present, transparent when unselected, so a row
does not shift by a pixel when it is clicked.

Each row is a button; the whole row is the target. A row carries seven columns —
code, name, category tag, cost, price, margin, status — and the values sit in
fixed-width right-aligned mono columns so they line up down the list. The bench
gives the list `1.24fr` against the record panel's `1fr` precisely because of
that column count; splitting it evenly truncated the product name, and the name
is the identity. The name yields space last, before the tag and after the
numbers; anything still too long truncates with the full text in `title`. Below 900px the row
becomes two lines — identity on top, numbers underneath — because the numbers
used to run off the right edge of a phone.

**Tablet:** below 900px the sidebar unpins and its brand and company switcher
share a line, the nav scrolls inside a 44vh box instead of pushing the content
below the fold, and touch targets grow — buttons to 42px, small buttons to 40px,
tabs to 44px. Fingers, not cursors.

## KPI tiles

Label in 11px muted, then the value at 32px mono with `-0.02em`, and a sparkline
to its right at the value's baseline. The number dominates the tile; the chart is
context and never replaces the value. Below both, a delta line in mono — Green
Deep when it rose, Danger when it fell, muted when it is just a count.

Sparklines are drawn in `components/Sparkline.js` from `lib/sparkline.js`: a
polyline plus a dot on the last point, no library. A flat series sits on the
middle line rather than the floor, because a series that did not move is not a
series at rock bottom. Null and undefined are dropped before scaling — a day with
no reading is not a day with zero.

## Elevation & depth

There is no shadow in this system except one: the modal, which is genuinely above
the page, carries `0 12px 32px -8px rgba(17,22,28,.22)` — an offset and a real
blur. Everything else is tone and seam.

## Icons

Drawn in `components/Icone.js`: 24-unit grid, 1.5 stroke, round caps and joins,
no fill, `currentColor`. Unicode glyphs are not used as icons — the same
character renders as a different shape on every operating system.

## Motion

One authored transition: the nav group chevron rotating 90° over 150ms. Focus,
hover and selection are instant state changes. An operator repeating a task
thirty times a day is not served by animation between the steps.

## Lineage

The mint palette, Manrope, the generous corner radius and the label/number/spark
KPI come from the PlanIQ dashboard study the owner chose as reference. What did
not come across: PlanIQ's horizontal pill navigation, which fits its seven
destinations and not this system's eight groups and thirty-odd screens, and its
low information density, which would fight the requirement to compare many
products at a glance.
