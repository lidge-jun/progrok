---
name: progrok workspace
colors:
  primary: "#22b795"
  accent: "#4cc9a6"
  background: "#0a0b0d"
typography:
  heading: { fontFamily: system-grotesk-stack, fontSize: 14px }
  body: { fontFamily: system-grotesk-stack, fontSize: 14px }
  machine: { fontFamily: system-mono-stack, fontSize: 12px }
iconography:
  system: "Lucide"
  weight: "regular"
  domain: "library-subset"
---

Reading this as: a **local tool UI** for developers who run progrok's OAuth bridge on their own
machine, with an **instrument-panel** language.

The reference is a rack-mounted audio interface's control surface, not a SaaS dashboard and not a
product landing. Everything that moves on screen is wired to a real signal; everything that does not
move is a labelled readout. A person should be able to glance at the top strip and know whether the
bridge is live, what it is talking to, and how loud the microphone is.

Do's: show measured values with units; keep one jade accent for "this is live"; let the transcript
and the meters own the stage; use mono for anything the machine produced.

Don'ts: no hero, no marketing copy, no gradient wash, no glass, no emoji, no invented numbers, no
decorative motion, no second accent hue.

## Dials

```
DESIGN_VARIANCE: 3
MOTION_INTENSITY: 3
Product density profile: D8 (developer console)
```

Reasoning: repeated-use local tool where predictability beats novelty, and the entire motion budget
belongs to one place — the audio meters, which are driven by a real AnalyserNode.

## Iconography decision (UX-ICON-01)

D8 routes to Hugeicons or Lucide. This project picks **Lucide**, self-hosted as a 9-symbol inline
SVG sprite.

- Ecosystem fit is intentional, not default: progrok ships as a CLI and its audience lives in the
  same toolchain where Lucide is the house style.
- The server's CSP is `default-src 'self'` with no external origins, so an icon CDN or icon font is
  impossible. Lucide's ISC license permits inlining a subset.
- One library, one optical weight (1.5px stroke, 24px viewBox, `currentColor`). No mixed sets.
- No domain or brand icon layer beyond the wordmark; a developer console has no category icons to
  differentiate.

## Tokens

The full primitive/semantic token table, the computed OKLCH values, and the measured WCAG contrast
pairs live in [devlog/_plan/260918_web_ui_redesign/040_design_system.md](devlog/_plan/260918_web_ui_redesign/040_design_system.md).

Shape lock: controls 8px, panels 12px, dialogs 16px, pill only for status chips.
Hue budget: neutrals + jade accent + amber warning + rose danger. Nothing else.

## Corrections made after review

This Design Read was written **after** the first implementation pass, which is out of order — §2
requires it before code. Two things changed because of it:

1. Icon system was an unexamined hand-drawn set. It is now a declared Lucide subset with a stated
   reason (UX-ICON-01).
2. The transcript cards carried a coloured left edge per speaker. Colour was doing the speaker
   distinction on its own, which is the thing the reference research warned against. Speaker is now
   carried by the label and its position; the accent stays on the assistant's label only.

