# LOOT_ — the ROBBED_ mascot

> Design source: [ROBBED Explorations.html](./ROBBED%20Explorations.html) §3 ("Mascot — the
> ROBBED_ trickster, four ways"). The ratified direction is **3a "Loot"** — the money bag that
> robbed itself. This doc specifies the component that ships that direction; the geometry and
> palette in the SVG are the design, not a suggestion. UI placement rules live in
> [web.md](./web.md); brand copy rules in the `lp-copy` rule.

## Concept

**Loot** is the ROBBED_ trickster: a green money sack that woke up and walked off with itself.
It wears a **permanent bandit mask** with two **darting pupils**, and it carries the brand
**`_`** (the terminal underscore that ends `ROBBED_` / `LOOT_`). The joke is the whole product
in one glyph — you're told to *secure the bag*; this one secures itself.

Tone: dry, terminal, a little larcenous. Loot is never cute-helpless — it is the one doing the
robbing. Empty states and the 404 lean into that ("this page has been robbed.").

## Component API

`import { LootMascot } from "@/shared/ui";`

Source: `apps/web/src/shared/ui/mascot/LootMascot.tsx` (+ `LootMascot.module.css`).

The component is a single **inline SVG** — pure presentational, **no `"use client"`, no hooks,
no client JS**. It renders identically on the server (RSC 404, OG image, favicon) and the client;
the only motion is CSS keyframes in the co-located module.

| Prop | Type | Default | Meaning |
| --- | --- | --- | --- |
| `size` | `number` | `96` | Rendered width in px. Height derives from the `232 × 222` viewBox (`height = size × 222 / 232`), so the mascot never distorts. |
| `animated` | `boolean` | `true` | `true` → idle motion on (`.figure` sway on the root, `.pupil` dart on both pupils). `false` → fully static — use for favicon / logo / OG image where CSS animation can't run. |
| `className` | `string` | — | Merged onto the root `<svg>` (via `cn`), after the animation class. |
| `label` | `string` | `"LOOT_ — the ROBBED_ mascot"` | Accessible name (`role="img"` + `aria-label`). Pass **`label=""`** to make the mascot **decorative** (`aria-hidden`, no role/label) — do this when adjacent text already names it (e.g. beside the `ROBBED_` wordmark, or under a 404 heading). |

```tsx
// hero / standalone, animated + announced
<LootMascot size={200} />

// decorative lockup element (the wordmark names the brand)
<LootMascot size={28} label="" />

// static brand mark (favicon / OG / logo slot)
<LootMascot size={40} animated={false} label="" />
```

## Animation & reduced motion

Two keyframes, both in `LootMascot.module.css`, both **off** under
`@media (prefers-reduced-motion: reduce)`:

- **`.figure` — `bob`** (`4.4s`): a slow whole-body sway (rotate ±2° + a 5px rise), applied to
  the **root `<svg>`** so it resolves in CSS pixels — a size-independent bob that reads the same
  at hero and favicon scale. `transform-origin: 50% 100%` pins the sway at the bag's base.
- **`.pupil` — `look`** (`6.4s`): the two pupils dart left/right (`±2.5` user units). Applied to
  the pupil `<circle>`s so the dart resolves in SVG user space and **scales with the mascot** (a
  favicon shouldn't dart as far as the hero).

Design decision (robbed-frontend, recorded in the component header): apply the sway to the outer
SVG (px, size-independent) and the dart to the inner circles (user units, size-relative). This
reproduces the exploration's div-based motion while keeping a single source of truth. The
exploration's "right eye winks every 5s" is intentionally **dropped** for v1 — a wink needs a
second animated element / mask and adds no accessibility value; revisit if the brand wants it.

`animated={false}` removes both classes entirely (not just pauses them), so a static export has
no residual transform.

## Palette & the design-token lint

The SVG fills are a fixed illustration palette (the sack greens `#16A34A → #4ADE80`, the mask
`#131A12`, the eye-whites `#EDF3ED`, the pupils `#0B0D0B`). These are the **character**, not
themeable UI, so `shared/ui/mascot/` is exempt from the `apps/web/tests/copy-lint.test.ts`
design-token-bypass check — exactly like the vendored `shared/ui/kit`, which owns its own colour
contract. Do **not** re-map the mascot fills to Tailwind tokens; that changes the illustration.

## The LOCKUP — mascot + wordmark

`import { MascotLockup } from "@/shared/ui";`

Source: `apps/web/src/shared/ui/mascot/MascotLockup.tsx`.

The design's **LOCKUP** (explorations §3/§4, "Loot adopted — brand lockups") is the mascot beside
the `ROBBED_` wordmark as one unit. `MascotLockup` **composes** the two ratified atoms —
`LootMascot` (the inline-SVG asset) and `Wordmark` (the wordmark whose terminal `_` is accent
green, matching `copy.BRAND` and the `CursorTag` motif) — so every surface renders an identical
lockup. It adds only layout: no illustration geometry, no raw colour. The mascot is decorative
(`label=""`) because the adjacent wordmark text names the brand for assistive tech.

| Prop | Type | Default | Meaning |
| --- | --- | --- | --- |
| `size` | `number` | `28` | Mascot width in px (height derives from the viewBox); the wordmark keeps its atom size. |
| `animated` | `boolean` | `true` | Mirrors `LootMascot`. Pass **`animated={false}`** for the static logo variant (headers / logo slots) so the brand mark never distracts. |
| `className` | `string` | — | Forwarded to the flex wrapper (e.g. to override the `gap`). |
| `wordmarkClassName` | `string` | — | Forwarded to the `Wordmark` (e.g. to scale the type). |

It is SSR-safe (no `"use client"`, no hooks) — usable in RSC headers and static shells.

## Placement lockups

The design calls out four placements. Status below is as of this doc:

| Lockup | Design copy / form | Status |
| --- | --- | --- |
| **404 / empty state** | mascot over **"this page has been robbed."** | **Wired** — `app/not-found.tsx` (global) and `app/t/[address]/not-found.tsx` (token 404) render `<LootMascot label="" />` above the heading. |
| **App header LOCKUP** | small mascot **+ `ROBBED_` wordmark** (design §4d "nav lockup, applies to all four pages") | **Wired** — `widgets/app-header` renders `<MascotLockup size={22} animated={false} />` as the home-link logo (static so the persistent header mark never distracts). |
| **Create-form logo slot** | "loot hidden in the create form's logo slot" | **Wired** — `features/launch-token` `ImageUpload` shows `<LootMascot size={38} animated={false} label="" />` as the default placeholder art for the empty 512×512 dropzone (with the size hint kept for affordance). |
| **Portfolio LOCKUP** | design §4 "apply the lockup to … portfolio" | **Wired** — `views/portfolio` `PortfolioClient` shows `<MascotLockup size={40} animated={false} />` above the connect-wallet prompt (Portfolio's own brand moment; connected users get the shared header lockup). |
| **Idle** | "sways · pupils dart" | Covered by the default `animated` behavior above. |

### Recommended follow-ups (not done here to keep the change tight)

- **Discover empty state**: when a filter yields no tokens, Loot + a "nothing here — Loot got to
  it first" line, mirroring the 404 treatment. (Deferred — `views/discover` is under active grid
  work; land it as its own change.)

Not for the **token-detail hero** — that surface is under active layout work; keep the mascot off
it until that settles.
