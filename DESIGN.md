---
name: Poof
colors:
  primary: "#ff5959"
  primary-dim: "#c94f4f"
  primary-hover: "#ff7070"
  bg: "#0a0a0b"
  surface: "#141416"
  surface-2: "#1b1b1e"
  text: "#ededed"
  muted: "#8a8a92"
  line: "#2a2a2e"
  green: "#3ad29f"
  on-primary: "#1a0e0e"
typography:
  wordmark:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: -0.03em
  h1:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.02em
  body:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  kicker:
    fontFamily: SF Mono
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0.12em
  mono:
    fontFamily: SF Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: 8px
  md: 14px
  pill: 999px
spacing:
  xs: 6px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 22px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.mono}"
    rounded: "{rounded.sm}"
    padding: 11px 18px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  button-ghost:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: 11px 18px
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: 22px
  input:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    typography: "{typography.mono}"
    rounded: "{rounded.sm}"
    padding: 11px 12px
  badge:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    typography: "{typography.mono}"
    rounded: "{rounded.pill}"
    padding: 3px 10px
---

# Poof Design System

## Overview

Poof's interface borrows the Cloudflare Workers Design System's structure (mono uppercase kickers, dot-grid backgrounds, corner-bracket panel framing, dashed-border interactive states, precise developer-tool feel) and reskins it with Raycast's palette: a dark-first, near-black canvas with layered grey surfaces and a single warm coral accent. The result reads as a focused, trustworthy utility, not a marketing site.

## Colors

Dark-first. The canvas is near-black; surfaces step up in lightness for depth; one coral accent (`primary`) carries all calls to action and the wordmark dot.

- `bg` near-black canvas, `surface` and `surface-2` for raised panels and inputs.
- `text` is high-contrast off-white; `muted` for secondary copy; `line` for hairlines and borders.
- `primary` (coral) is the only accent. `on-primary` is the near-black text used on coral fills.
- `green` is reserved for positive/"safe" states; use sparingly.

## Typography

Two families: Inter for UI and headings, a monospace face for kickers, labels, code, links, and anything that should feel like a terminal.

- `wordmark` and `h1` are tight, slightly negative tracking.
- `kicker` is uppercase mono with wide tracking, used for the `// section` labels.
- `mono` carries code, the link field, PIN inputs, and button text.

## Layout

A single centred column (max ~680px) on the dot-grid canvas. Content is a vertical stack of panels with generous padding. One task per screen: compose, or reveal.

## Elevation and Depth

Depth is communicated by surface lightness and a 1px `line` border, not shadows. Panels carry coral corner brackets (top-left, bottom-right) as the signature framing device. Interactive surfaces shift their border to `primary` on hover.

## Shapes

Rounded corners: `sm` for controls, `md` for panels, `pill` for badges. Dashed borders mark drop targets and secondary affordances.

## Components

- `button-primary`: coral fill, near-black text, mono label. The single prominent action per screen.
- `button-ghost`: transparent, hairline border, used for secondary actions.
- `panel`: the surface card with corner brackets.
- `input`: surface-2 fill, mono text, used for the link field and PIN entry.
- `badge`: pill outline in coral, used for the clip Kind on the reveal card.

## Do's and Don'ts

- Do keep one coral accent per screen; the eye should land on a single action.
- Do use mono for anything machine-ish (links, PINs, code, kickers).
- Do state risk honestly in `muted` copy near the relevant control.
- Don't introduce a second accent colour or use coral for large fills beyond the primary button.
- Don't add drop shadows; depth comes from surface steps and the corner brackets.
- Don't soften the developer-tool tone with rounded, friendly illustration.
