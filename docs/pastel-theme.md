# Pastel Theme — Quick Pricer Design Reference

The **Pastel** theme is the light lavender design system used by Torn Bazaar Quick
Pricer (`qp-` prefix). The current userscript uses these tokens and components for its
settings panel, API-key prompt, confirmations, toasts, floating circular bubble, and
per-item buttons.

Design goals in the current source:

- **Soft and friendly** — a light lavender palette on white cards with muted status
  colors.
- **Rounded everything** — cards, fields, buttons, and toasts use generous radii;
  the floating control is a compact circle and toasts are pills.
- **Playful motion** — dialogs spring in, toasts slide up, and RW dots blink.
- **PDA-friendly** — components fit a 320 px-wide modal and provide touch targets.

## Naming convention

The current script uses a `qp-` prefix. BEM-ish selectors are used for the UI:

| Pattern | Example |
|---|---|
| Block | `qp-modal`, `qp-bubble`, `qp-toast` |
| Element | `qp-head__title`, `qp-toast__icon` |
| Modifier | `qp-btn--primary`, `qp-btn--danger`, `qp-btn--rw` |

## Typography and external resources

- The current source creates `<link id="qp-font">` pointing to
  `https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&display=swap`.
- The CSS variable is `--qp-font: 'Nunito', system-ui, sans-serif`; if the font request
  is blocked, the browser falls back to `system-ui`.
- Weights are 700, 800, and 900. Labels are small, muted, and letter-spaced; titles and
  buttons use sentence case or short uppercase field labels.
- The userscript sends its API key only to `api.torn.com`. The Google Fonts request is a
  separate third-party network request and is not used to transmit the key.

## Color tokens

These values are declared by the current source in the injected stylesheet:

```css
:root {
  --qp-accent:    #7a6bd6;   /* primary actions, focus, links     */
  --qp-accent-bg: #efeafd;   /* accent tint: badges, busy states  */
  --qp-ink:       #2b2740;   /* primary text                      */
  --qp-muted:     #8a86a0;   /* secondary text, labels, icons     */
  --qp-field-bg:  #f7f6fb;   /* input and card backgrounds        */
  --qp-border:    #e5e1f4;   /* field borders, separators         */
  --qp-ok:        #3aa06b;   /* success                           */
  --qp-ok-bg:     #e4f3ec;   /* success tint                      */
  --qp-danger:    #c25a5a;   /* destructive / error               */
  --qp-danger-bg: #fbecec;   /* danger tint                       */
  --qp-warn:      #c9782e;   /* warning text                      */
  --qp-warn-bg:   #fdf6ec;   /* warning tint                      */
  --qp-rw:        #f0a35e;   /* ranked-war accent                 */
  --qp-rw-bg:     #fdeeda;   /* ranked-war tint                    */
  --qp-font: 'Nunito', system-ui, sans-serif;
}
```

Supporting values used in the current CSS include:

| Use | Value |
|---|---|
| Card / bubble / toast surface | `#fff` |
| Accent hover | `#6a5ac6` |
| Ghost / close-button surface | `#f4f2fa` (hover `#e9e5f6`) |
| Danger tint hover | `#f6dede` |
| Toggle track (off) | `#d9d5e8` |
| Row separator | `#edeaf6` |
| Modal close icon | Material `close` SVG, `currentColor` |
| Note-strip text | `#9a7b45` |
| Scrim | `rgba(43,39,64,.28)` with 2 px backdrop blur |
| RW rarity yellow dot | `#e8c97e` |

Status colors are generally used as a strong foreground paired with a pale background
tint.

## Shape and elevation

| Element | Radius | Shadow |
|---|---|---|
| Modal | 20 px | `0 16px 48px rgba(43,39,64,.35)` |
| Toggle card | 14 px | none |
| Fields, notes, buttons, number cells | 12 px | primary buttons use an accent shadow |
| Per-item buttons | 10 px | `0 3px 8px rgba(122,107,214,.3)` |
| Floating bubble | 50% (52 px circle) | `0 10px 26px rgba(122,107,214,.4), 0 2px 6px rgba(0,0,0,.08)` |
| Toasts | 999 px | `0 6px 18px rgba(43,39,64,.16)` |

Fields use a 2 px border (1.5 px for compact number cells) and change to the accent
color on `:focus-within`.

## Motion and keyframes

The current source defines:

```css
@keyframes qp-pop-spring {
  0%   { transform: scale(.4) translateY(14px); opacity: 0; }
  55%  { transform: scale(1.08) translateY(-3px); opacity: 1; }
  75%  { transform: scale(.97) translateY(1px); }
  100% { transform: scale(1) translateY(0); }
}
@keyframes qp-toast-in {
  from { transform: translateY(12px); opacity: 0; }
  to   { transform: translateY(0); opacity: 1; }
}
@keyframes qpDotBlink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.25; }
}
```

- Modals use `qp-pop-spring .45s cubic-bezier(.34,1.56,.64,1) both`.
- Toasts use `qp-toast-in .25s cubic-bezier(.2,.9,.3,1.2) both`.
- Hover and switch transitions use `.15s`.
- There is no `qp-rw-blink` or `qp-spin` keyframe in the current source; RW dots use
  `qpDotBlink`.

## Iconography

The script embeds Material Design SVG assets reviewed from Google's official Material
source and acquired from the documented Google Fonts CDN URLs. The CDN resources can
represent differing legacy serializations, so they are not claimed to be byte-for-byte
copies from one repository revision. Paths are normalized to a 24×24 viewBox, use
`currentColor`, and are inlined so the single-file PDA userscript needs no runtime icon
request. `docs/assets/material-icons/README.md` records every CDN URL, review status,
and Apache License 2.0 attribution. Icons with no remaining consumer
(`inventory_2`, `more_vert`) were removed from the map and from the provenance
assets; the retained set is `info`, `refresh`, `settings`, `key`, `add`, `undo`,
`visibility`, `visibility_off`, `check_circle`, `error`, `warning`,
`sports_martial_arts`, `open_in_new`, and `close`.

## Components

### Modal shell

A fixed full-screen scrim centers a white card that is 320 px wide, capped at
`calc(100vw - 32px)`, and scrolls if needed:

```html
<div class="qp-overlay">
  <div class="qp-modal">
    <div class="qp-head">
      <button type="button" class="qp-head__badge qp-head__badge--action"
              aria-label="What's new in Quick Pricer"><!-- Material info SVG --></button>
      <div>
        <div class="qp-head__title">Quick Pricer settings</div>
        <div class="qp-head__sub">v2.9.4 · <a href="…">GitHub</a></div>
      </div>
      <button class="qp-close" aria-label="Close"><!-- Material close SVG --></button>
    </div>
    <div class="qp-body"><!-- 12px-gapped column of fields, toggles, buttons --></div>
  </div>
</div>
```

In the settings panel the header badge is a real button (`.qp-head__badge--action`,
`aria-label="What's new in Quick Pricer"`) rather than a decorative gear. It opens the
changelog *above* the settings panel instead of replacing it, so the two dialogs do
stack; Enter and Space are handled explicitly with `preventDefault` so activation stays
single-shot. The footer **Clear cache** button is text-only, and the dead `.qp-btn svg`
sizing rule was removed along with the unused `inventory_2` and `more_vert` icon map
entries and assets. Header badges now hold only 22 px Material icons, so the per-variant
`font-size: 16px` was dropped and each `--warn`/`--rw` variant is declared once instead
of in two split rules.

The current script adds `role="dialog"`, `aria-modal="true"`, Escape-to-close, and a
Tab focus trap to the modal. Clicking the scrim also closes the dialog.

### Stacked dialogs

Overlays share one `z-index: 99999`, so document order decides which one paints on
top. Because the changelog is appended to `document.body` last, opening it from the
settings header puts it above the settings panel. Each overlay keeps its own focus trap
and its own close button, scrim, and Escape handler, and those handlers remove only
their own overlay — dismissing the changelog reveals the settings panel with unsaved
edits intact. `showChangelog()` captures `document.activeElement` before moving focus to
its close button and hands focus back on close when that element is still connected, so
the keyboard returns to the settings info button; if it has been removed in the
meantime, focus is simply left to fall back instead of being moved to a detached node.
The buried panel is not made `inert` and its controls are untouched.

Escape is scoped to the top-most overlay (`isTopOverlay`, i.e. the last `.qp-overlay`
in the DOM) so a keystroke aimed at the top dialog can never close a dialog buried
beneath it. The route-level first-Add changelog gate is unchanged and still refuses to
open while any overlay is present, so automatic display never stacks onto the settings
panel or the API-key prompt; only the deliberate settings info action stacks.

### Text field and API-key prompt

The API-key prompt and settings panel use a muted label, pale field, password input,
and an eye toggle implemented with `.qp-eye-toggle`:

```html
<div class="qp-label">PUBLIC API KEY</div>
<div class="qp-field">
  <input type="password" id="qpApiKey" autocomplete="off" spellcheck="false">
  <div class="qp-eye-toggle" role="button" tabindex="0"
       aria-label="Show or hide API key"><!-- eye SVG --></div>
</div>
```

The prompt explains that a Public-scope key is sufficient and links to Torn's API
preferences. Saving a valid 16-character alphanumeric key does not require a page
reload.

### Note strip

A warning-tinted strip provides security or behavior hints:

```html
<div class="qp-note"><span>🔒</span><span>A Public-level key is enough…</span></div>
```

### Number-cell grid

The settings panel uses a compact three-column grid for discount/markup, alert
threshold, and cache lifetime:

```html
<div class="qp-numgrid">
  <label class="qp-numcell">
    <span class="qp-numcell__label">DISCOUNT</span>
    <span class="qp-numcell__row"><input type="number" value="0"><span class="qp-numcell__unit">%</span></span>
  </label>
  <!-- ALERT AT / CACHE -->
</div>
```

The first label changes between `DISCOUNT` and `MARKUP` according to the Undercut
market toggle.

### Toggle rows

A flat pale card contains rows separated by hairlines. Each row has a bold name and a
muted description on the left and a native checkbox switch on the right. The switch is
36×21 px, off in `#d9d5e8`, on in the accent color, with a white 16 px knob.

Current rows are:

- NPC floor enforcement
- Skip RW weapons
- Skip $1 items
- Undercut market

### Buttons

| Variant | Class | Current look |
|---|---|---|
| Primary | `qp-btn--primary` | Accent fill, white text, accent shadow, hover `#6a5ac6` |
| Ghost | `qp-btn--ghost` | Pale fill, muted text, hover `#e9e5f6` |
| Danger | `qp-btn--danger` | Danger tint, danger text, hover `#f6dede` |
| RW / special | `qp-btn--rw` | Orange fill, white text, orange shadow |

Buttons sit in `.qp-btn-row` with an 8 px gap. The current settings footer combines a
danger-tinted Clear cache button with a wider Save settings button.

### Route-aware circular bubble

The current source creates one fixed 52 px circular `.qp-bubble` at the bottom center
by default. Only two Torn bazaar routes are supported; everything else hides the bubble
via `.qp-bubble-hidden` and performs no action:

- **Add (`bazaar.php#/add`):** the bubble shows the text label **Fill**
  (`.qp-bubble-label`, `font: 900 13px/1`, white on the accent fill) and the tap runs
  Quick Fill for the loaded Add Items rows. Its `aria-label` is `Quick Fill`.
- **Manage (`bazaar.php#/manage`):** the bubble shows the Material `refresh` icon with
  `aria-label` `Update all prices`, and the tap runs Update All.
- **Base `bazaar.php#/`, Personalize, and any unknown route:** the bubble is hidden,
  including while dragging. The drag branch deliberately never removes
  `.qp-bubble-hidden`, so no transient state can reveal it on an unsupported route.
- After an Add batch settles, the bubble switches to the Material `close` icon
  (`aria-label` `Clear prices and quantities`) in the same accent color — there is no
  pink completion state and no `check_circle` icon. Tapping it clears the price *and*
  quantity of every currently loaded row through the same per-item clear a manual
  queue removal performs, and returns the bubble to **Fill**. The state is in-memory
  only, so a reload, a route change, or a change of Add Items category starts again at
  **Fill**; the category reset compares a signature of the leading loaded item IDs, so
  a category lazy-loading more rows as the user scrolls keeps its Clear state while a
  genuine category switch resets it.

Dragging uses Pointer Events, clamps movement to the viewport, and persists the
position in userscript storage. Arrow keys move it in 10 px steps. A long-press of
350 ms opens settings from either supported route; movement beyond 6 px suppresses both
settings and tap actions. Once a drag actually begins, the bubble renders the Material
`settings` icon as a hint that the gesture moves it, takes the transient accessible
label `Move bubble`, and restores the route state and its label on release or cancel.
During a batch run the bubble displays `completed/total` on a supported route; a route
change to an unsupported route hides the bubble immediately, mid-batch, and it stays
hidden when the batch completes.

### Toasts

White pill-shaped toasts are stacked bottom-center with a 20 px status icon. Success
uses `--qp-ok-bg`/`--qp-ok` with the Material `check_circle` icon, errors use
`--qp-danger-bg`/`--qp-danger` with the Material `error` icon, and informational
messages use `--qp-warn-bg`/`--qp-warn` with the Material `info` icon — all 15×15
SVGs rather than check/exclamation/`i` text glyphs. They use `role="status"`, or
`role="alert"` for errors, and are removed after their duration.

### Per-item buttons

Rows receive a 34×34 px accent button with a white inline SVG:

- Add Items rows use a plus icon and switch to a danger-tinted undo button after a
  successful fill.
- Manage rows use a refresh icon.
- A detected RW weapon receives a blinking rarity dot (`rw-yellow`, `rw-orange`,
  `rw-red`, or `rw-unknown`) before the button. The dot is informational; the button
  remains available and asks for confirmation before pricing.
- Failed Add Items fetches temporarily add a red state and a retry hint to the button.

The current source does not add a separate NPC-floor badge or a dashed RW border; the
manage-price input briefly gets an orange border when the new price equals the NPC
sell price.

### Confirmation dialogs

The script uses the same modal shell for RW pricing and large manage-price changes. A
warning or RW badge identifies the kind of confirmation. The manage-price confirmation
shows the item name, current price, proposed price, percentage difference, and an
Update price action. The current source does not include a separate CURRENT → NEW
comparison-card component.

## Accessibility checklist

- Dialogs have `role="dialog"` and `aria-modal="true"`, close on Escape, and trap Tab
  focus. When two dialogs stack (the settings panel and the changelog above it),
  Escape belongs to the top-most one only and each dialog's close button, scrim, and
  Escape handler remove only their own overlay. Closing the top dialog returns focus to
  the control that opened it.
- Icon controls have accessible labels, and the API-key eye toggle supports click,
  Enter, and Space. The bubble carries a per-state `aria-label` (`Quick Fill`,
  `Clear prices and quantities`, `Update all prices`), and the settings info action
  supports click, Enter, and Space.
- Toasts use status/alert roles.
- The circular bubble is keyboard-operable with arrow keys and activation keys.
- The bubble and per-item controls provide touch targets of at least 34 px.

## Applying the theme to a new script

1. Pick a short class prefix and copy the token block, keyframes, and component CSS,
   renaming the prefix.
2. Add a stable stylesheet element and remove stale styles and floating UI on startup
   so re-injection cannot duplicate controls. If using a remote font, inject it
   explicitly and document the third-party request.
3. Keep z-index layering: floating bubble `99998` < overlays `99999` < toasts `100000`.
4. Reuse the component vocabulary—modal shell, fields, note strips, number cells,
   toggle rows, buttons, bubble, and toasts—rather than inventing new patterns.
