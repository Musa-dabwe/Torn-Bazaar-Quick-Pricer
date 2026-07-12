# Pastel Theme — Unified Design Reference

The **Pastel** theme is the shared UI design system for all of our Torn userscripts.
It was first applied to **Torn City Loot Finder** (`tcif-` prefix) and, as of v2.9.2,
to **Torn Bazaar Quick Pricer** (`qp-` prefix). Any new script should adopt these
tokens and components so everything we ship looks and feels like one family.

Design goals:

- **Soft and friendly** — a light lavender palette on white cards, no harsh borders,
  no terminal chrome. Status colors are muted pastels, never saturated alarm colors.
- **Rounded everything** — cards, fields, buttons and chips use generous radii;
  pills (`border-radius: 999px`) for floating chrome and toasts.
- **Playful motion** — dialogs spring in, toasts slide up, attention dots blink.
  Motion is short (≤ 0.5 s) and springy, never blocking.
- **PDA-first** — components are sized for a 320 px-wide modal and touch targets
  (34 px minimum), and work identically on desktop.

## Naming convention

Each script uses the same class vocabulary under its own prefix so styles never
collide when two scripts run on one page:

| Script | Prefix | Example |
|---|---|---|
| Torn Bazaar Quick Pricer | `qp-` | `.qp-modal`, `.qp-btn--primary` |
| Torn City Loot Finder | `tcif-` | `.tcif-modal`, `.tcif-btn` |
| (new scripts) | pick a short prefix | `.xx-modal`, … |

BEM-ish modifiers: block (`qp-modal`), element (`qp-head__title`), modifier
(`qp-btn--danger`).

## Typography

- **Font:** [Nunito](https://fonts.google.com/specimen/Nunito), weights **700 / 800 / 900**,
  falling back to `system-ui, sans-serif`. Inject the Google Fonts stylesheet once per script:

  ```html
  <link rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&display=swap">
  ```

- Everything is bold: body text is 700, labels and names 800, numbers and primary
  buttons 900. There is no regular weight in this system.
- Labels are small caps-style: 9.5–11 px, 800, letter-spaced (`.4px`–`.6px`), muted color.
- Sentence case for titles and buttons ("Save settings", "RW weapon detected") —
  ALL-CAPS is reserved for tiny field labels and badges.

## Color tokens

Declare these as CSS custom properties on `:root`, prefixed per script
(shown here with the `qp-` prefix):

```css
:root {
  --qp-accent:    #7a6bd6;   /* primary actions, focus, links     */
  --qp-accent-bg: #efeafd;   /* accent tint: badges, busy states  */
  --qp-ink:       #2b2740;   /* primary text                      */
  --qp-muted:     #8a86a0;   /* secondary text, labels, icons     */
  --qp-field-bg:  #f7f6fb;   /* input & card backgrounds          */
  --qp-border:    #e5e1f4;   /* field borders, separators         */
  --qp-ok:        #3aa06b;   /* success                           */
  --qp-ok-bg:     #e4f3ec;   /* success tint                      */
  --qp-danger:    #c25a5a;   /* destructive / error               */
  --qp-danger-bg: #fbecec;   /* danger tint                       */
  --qp-warn:      #c9782e;   /* warning text                      */
  --qp-warn-bg:   #fdf6ec;   /* warning tint (note strips)        */
  --qp-rw:        #f0a35e;   /* special/RW accent (orange)        */
  --qp-rw-bg:     #fdeeda;   /* special/RW tint                   */
  --qp-font: 'Nunito', system-ui, sans-serif;
}
```

Supporting hexes used alongside the tokens:

| Use | Value |
|---|---|
| Card / chip / toast surface | `#fff` |
| Accent hover | `#6a5ac6` |
| Ghost-button / close-button surface | `#f4f2fa` (hover `#e9e5f6`) |
| Danger tint hover | `#f6dede` |
| Toggle track (off) | `#d9d5e8` |
| Row separator inside cards | `#edeaf6` |
| Drag-handle glyph | `#c5c1d6` |
| Note-strip text | `#9a7b45` |
| Scrim | `rgba(43,39,64,.28)` + `backdrop-filter: blur(2px)` |
| RW rarity yellow dot | `#e8c97e` |

Rule of thumb: every status color comes as a **pair** — a strong foreground
(`--qp-ok`) and a pale background tint (`--qp-ok-bg`). Foregrounds go on tints,
white goes on strong fills. Never place a strong status color on white text-size
backgrounds or vice versa.

## Shape & elevation

| Element | Radius | Shadow |
|---|---|---|
| Modal | 20px | `0 16px 48px rgba(43,39,64,.35)` |
| Cards inside modals (key card, toggles) | 14px | none (flat, `--field-bg`) |
| Fields, notes, buttons, numcells | 12px | primary buttons only: `0 4px 12px rgba(122,107,214,.35)` |
| Small square buttons (per-item, badges) | 10–11px | `0 3px 8px rgba(122,107,214,.3)` |
| Chips, toasts, switches, nav strips | 999px (pill) | chip `0 8px 24px rgba(43,39,64,.18), 0 2px 6px rgba(0,0,0,.08)`; toast `0 6px 18px rgba(43,39,64,.16)` |

Borders: fields use `2px solid var(--qp-border)` (or 1.5px for compact cells),
switching to `var(--qp-accent)` on `:focus-within` and to `var(--qp-danger)` +
`--qp-danger-bg` for the error state. Everything else is borderless.

## Motion

```css
@keyframes qp-pop-spring {                 /* modals & popups */
  0%   { transform: scale(.4) translateY(14px); opacity: 0; }
  55%  { transform: scale(1.08) translateY(-3px); opacity: 1; }
  75%  { transform: scale(.97) translateY(1px); }
  100% { transform: scale(1) translateY(0); }
}
@keyframes qp-toast-in {                   /* toasts */
  from { transform: translateY(12px); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}
@keyframes qp-rw-blink {                   /* attention dots */
  0%, 100% { opacity: 1; } 50% { opacity: .25; }
}
@keyframes qp-spin { to { transform: rotate(360deg); } }  /* busy spinners */
```

- Modals: `qp-pop-spring .45s cubic-bezier(.34,1.56,.64,1) both`
- Toasts: `qp-toast-in .25s cubic-bezier(.2,.9,.3,1.2) both`
- State transitions (hover, switch knobs): `.15s`

## Iconography

Inline SVG only — no icon fonts, no external images. Feather-style strokes:
`fill="none" stroke="currentColor"` (or a literal accent hex in header badges),
`stroke-width` 2.2–2.6, round caps and joins, on a 24×24 viewBox rendered at
13–20 px. Emoji are allowed as badge glyphs for warning/flavor dialogs
(🔒 ⚠️ 🗡️).

## Components

Markup templates below use the `qp-` prefix; swap the prefix for other scripts.
Live reference: the demo file `tornquickpricer.html` (Claude design, sections 4a–4e)
and the shipped implementations in both userscripts.

### Modal shell

Fixed full-screen overlay (scrim + blur) centering a white 320 px card.

```html
<div class="qp-overlay">
  <div class="qp-modal">
    <div class="qp-head">
      <div class="qp-head__badge"><!-- 40×40 accent-tinted rounded square, icon inside --></div>
      <div>
        <div class="qp-head__title">Quick Pricer settings</div>
        <div class="qp-head__sub">v2.9.2 · <a href="…">GitHub</a></div>
      </div>
      <button class="qp-close" aria-label="Close">✕</button>
    </div>
    <div class="qp-body"><!-- 12px-gapped column of fields/cards/buttons --></div>
  </div>
</div>
```

- Badge variants: default accent (`--qp-accent-bg`), `--warn` (`--qp-warn-bg`),
  `--rw` (`--qp-rw-bg`, may carry a blinking `qp-rw-dot`).
- The ✕ close button lives in the header — no "Close" button in the footer.

### Text field

```html
<div class="qp-label">PUBLIC API KEY</div>
<div class="qp-field">
  <input type="password" placeholder="ENTER KEY">
  <button class="qp-eye" aria-label="Show or hide API key"><!-- eye svg --></button>
</div>
```

States: `:focus-within` → accent border; `.qp-field--error` → danger border + tint.
Secret fields get an eye toggle that flips `input.type`.

### Note strip

Warning-tinted rounded strip for security hints and explainers:

```html
<div class="qp-note"><span>🔒</span><span>A Public-level key is enough…</span></div>
```

### Number-cell grid

Compact 3-up grid for numeric settings — label on top, big 900-weight number
with a unit suffix:

```html
<div class="qp-numgrid">
  <label class="qp-numcell">
    <span class="qp-numcell__label">DISCOUNT</span>
    <span class="qp-numcell__row"><input type="number" value="5.0"><span class="qp-numcell__unit">%</span></span>
  </label>
  <!-- ALERT AT / CACHE … -->
</div>
```

### Toggle rows

A flat `--field-bg` card containing rows separated by hairlines. Each row:
bold name + tiny muted description on the left, a pill switch on the right.
The switch is a 36×21 px pill — `#d9d5e8` off, `--qp-accent` on, with a white
16 px knob that slides 15 px. Implement it as a native checkbox (Quick Pricer)
or an `aria-pressed` button (design demo); the visual is identical.

### Buttons

| Variant | Class | Look |
|---|---|---|
| Primary | `qp-btn--primary` | accent fill, white 900 text, accent shadow, hover `#6a5ac6` |
| Ghost / cancel | `qp-btn--ghost` | `#f4f2fa` fill, muted text |
| Danger | `qp-btn--danger` | danger tint fill, danger text |
| RW / special | `qp-btn--rw` | `--qp-rw` orange fill, white text, orange shadow |

Buttons sit in a `qp-btn-row` (8px gap, each `flex: 1`; the primary may take
`flex: 1.4`). Text links inside modals use `qp-help` (centered, accent, 800).

### Floating chip

The script's persistent entry point: a white pill fixed on the page, draggable
by its `⋮⋮` handle (`touch-action: none` for PDA), holding the main action
button (accent pill) and a circular ghost gear button.

Busy state: the action button swaps to accent-tint background with accent text
(and optionally a `qp-spin` spinner) while showing progress, e.g. "Updating 12/34".

### Toasts

White pills stacked bottom-center (`column-reverse`, above the chip), each with
a 20 px circular status icon: success ✓ on `--qp-ok-bg`, error ! on
`--qp-danger-bg`, info on `--qp-warn-bg`. Auto-dismiss; `role="status"`
(or `role="alert"` for errors).

### Per-item buttons

34×34 px, radius 10 px, accent fill with a white stroke icon (＋ to fill,
↺ to update). States:

- **Filled / undo** — danger tint + danger icon (optionally an "UNDO" pill with label).
- **RW weapon** — warn tint with a `1.5px dashed #eccfa8` border; requires a
  confirm dialog before pricing.
- A blinking `qp-rw-dot` (round, white-ringed, `qp-rw-blink`) marks RW items;
  rarity hues: yellow `#e8c97e`, orange `--qp-rw`, red `--qp-danger`,
  unknown `--qp-accent`.
- **NPC floor** — `qp-npc-badge`: tiny warn-tinted pill labelled "NPC FLOOR".

### Confirm dialogs

Same modal shell, warn or RW badge in the header, message body, then
`qp-btn-row` with ghost cancel + primary (or `--rw`) confirm. For price changes,
the design offers a CURRENT → NEW compare card (`qp-compare`) with the new value
in `--qp-ok`.

## Accessibility checklist

- Dialogs: `role="dialog"` + `aria-modal="true"`, Escape closes, Tab is trapped,
  initial focus on the primary control.
- Every icon-only control has an `aria-label`; switches expose state via a real
  checkbox or `aria-pressed`.
- Toasts use `role="status"` / `role="alert"`.
- Touch targets ≥ 34 px; drag handles are keyboard-operable where movement matters.

## Applying the theme to a new script

1. Pick a short class prefix and copy the token block, keyframes and component
   CSS (from this file or `torn-bazaar-quick-pricer.user.js` / the Loot Finder),
   renaming the prefix.
2. Inject the Nunito `<link>` and a single `<style>` element; give both stable
   ids and sweep them (plus any floating UI) on startup so re-injection can't
   duplicate chrome.
3. Keep z-index layering: floating chip `99998` < overlays `99999` < toasts `100000`.
4. Reuse the component vocabulary — modal shell, fields, note strips, numcells,
   toggle rows, button variants, chip, toasts — rather than inventing new patterns.
