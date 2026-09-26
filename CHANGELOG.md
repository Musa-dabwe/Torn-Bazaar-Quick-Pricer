# Changelog

The userscript metadata in `torn-bazaar-quick-pricer.user.js` currently declares
**version 2.9.4**. The project package metadata is kept at the same version. Releases
should be tagged (`v2.9.4`, …) and published as GitHub Releases when merged to `main`,
so users can diff versions and roll back easily.

## 2.9.4 — 2026-09-25

- **API v2 batching:** fresh cache entries remain local; uncached item IDs are grouped
  into requests of at most 10, serialized 600 ms apart to respect Torn's rate limit.
- **Conservative fallback:** a malformed or unusable v2 schema fails the whole batch
  over to the existing per-item API v1 path. Valid items in mixed responses are kept,
  while malformed items fail independently.
- **Circular route-aware bubble:** the former pill chip is now a draggable 52 px
  circular Material 3 bubble. It is shown only on the **Add** and **Manage** routes;
  the base route and Personalize hide it. On Add the bubble reads **Fill**, and once
  a fill finishes it switches to a `close` icon whose tap clears the price *and*
  quantity of every listed item — the same per-item clear a manual queue removal
  performs, so no stale price or leftover quantity survives a clear. Changing the Add
  Items category returns the bubble to **Fill** instead of leaving a stale clear
  action pointed at rows the user can no longer see. On Manage it shows a refresh
  icon and returns to that state after Update All.
- **Settings by long press:** long-pressing the bubble for 350 ms opens the settings
  panel from either supported route; dragging past the drag threshold shows the
  settings affordance inside the bubble and restores the route state on release.
- **Settings panel:** the header badge is now a keyboard-accessible `info` button that
  opens the changelog **on top of** the still-open settings panel — dismissing the
  changelog (scrim, close button, or Escape) reveals the interactive settings dialog
  with unsaved edits intact. **Clear cache** is a text-only button that still reports
  `Cleared ✓` for 1.5 seconds. Icons with no remaining consumer (`inventory_2`,
  `more_vert`) were dropped from the map and from the provenance assets, along with the
  now-dead `.qp-btn svg` styling rule.
- **Material 3 icons:** inline SVG paths are Material Design assets reviewed from
  Google's official Material source and acquired from the documented Google Fonts CDN
  URLs. The assets README records the differing legacy serializations and Apache
  License 2.0 attribution. The single-file userscript makes no runtime icon request.
- **PDA initialization:** immediate root detection, a one-shot DOMContentLoaded
  fallback, bounded observer/poll cleanup, and a 20-second timeout cover delayed
  Torn PDA rendering. API prompt, settings, and changelog dialogs do not force focus
  into the API-key field.
- **Changelog modal:** these notes open once per version on the Add route — either
  automatically on the first Add visit or from the settings header info button at any
  time. Scrim, close button, and Escape all close the dialog and mark the version seen.
  Because the two overlays can now be stacked, Escape belongs to the top-most dialog
  only: pressing it with the changelog above the settings panel closes only the
  changelog, and the automatic first-Add gate still refuses to open a second dialog
  over an open settings panel or API-key prompt.
- **Manual verification:** the installed userscript was exercised on the real batch
  path and rows filled in groups of 10, matching the API v2 batching behavior. The
  final live desktop/PDA smoke test remains pending as a release gate.

## 2.9.3 — 2026-07-12

Restores above-market pricing (driven by tester feedback — a negative discount used to
list items above market value, and the 2.9-era `0–99.9%` clamp silently removed it,
pricing at market value instead).

- **New "Undercut market" toggle** in settings chooses the direction of the percentage:
  on (default) prices **N% below** market — a discount, exactly as before; off prices
  **N% above** market — a markup. The user enters a positive percentage and flips the
  toggle instead of typing a negative discount that got clamped away.
- The number-cell label flips between **DISCOUNT** and **MARKUP** as the toggle changes,
  so the active direction is always visible.
- The `0–99.9%` ceiling applies in both directions — a markup tops out at +99.9%
  (approximately 2× market value). Below-market prices are floored at the NPC sell
  price; that floor cannot affect a markup.

## 2.9.2 — 2026-07-12

UI release — the current source contains the pastel modal and component styling.

- **Pastel UI** across the settings panel, API key prompt, confirmation dialogs,
  toasts, floating pill chip, and per-item buttons. The current source loads the
  Nunito display font from Google Fonts and falls back to `system-ui` if it is blocked.
- Settings dialog organized around a compact number-cell grid for Discount / Alert at /
  Cache, toggle rows with descriptions, a header close button, and version + GitHub
  link in the header.
- API key prompt includes a link to Torn's API preferences page.
- Toasts are white pills with a status icon; confirmation dialogs use the pastel modal
  with warning or RW badges.
- Design tokens and component reference are documented in `docs/pastel-theme.md`.

## 2.9.1 — 2026-07-08

Fixes driven by tester feedback from a 200-item bazaar stress test.

- **Batch runs no longer auto-scroll the page.** Torn lazy-loads bazaar rows, so
  Quick Fill / Update All process only the rows already rendered. When the last loaded
  row is below the fold, the summary tells the user to scroll down and run again.
- **$1 listings are skipped by Update All.** Pricing an item at $1 is Torn's convention
  for intentional giveaway/transfer listings. The Skip $1 Items setting is on by
  default; per-item buttons still update them on explicit click.
- **Price-change confirmations name the item** and show the current and proposed prices.
- The alert threshold is user-adjustable (Alert at %, default 20, range 0–1000).
- API key prompts state that a Public-scope key is enough and warn against using a
  Full Access key in third-party scripts.

## 2.9 — 2026-07-06

Implementation of the v2.8.9 code audit.

### Reliability
- **Request queue hardened**: 15-second timeout with timeout, error, and abort handling.
- **Torn API error handling**: rate-limit errors (code 5) back off 5 seconds and retry
  up to twice; fatal errors (2 incorrect key, 8 IP block, 9 API disabled) stop the run
  and notify once.
- **Rate-limit compliance**: requests are spaced 600 ms apart (≤100 requests/min).
- **Request dedupe**: duplicate fetches for the same item share one request.
- **Price cache**: held in memory, stale entries pruned at startup, and persisted with
  a debounced write.
- **Bootstrap**: a single MutationObserver with a hard 20-second root-search timeout.
- **Re-injection cleanup**: stale chip, toasts, overlays, and stylesheet are removed at
  startup.

### Correctness and input safety
- API key validation uses one shared 16-alphanumeric-character rule at every entry
  point; stored keys are assigned through the DOM rather than interpolated into HTML.
- Discount is clamped to 0–99.9%.
- Update All awaits each item and reports actual updated, declined, and failed counts.
- Quantity parsing is anchored to the end of the item title so names containing
  `x<digits>` are not misread.

### UX
- Blocking `alert()`/`confirm()` dialogs were replaced with toasts and a styled confirm
  dialog.
- Batch runs show live progress and an accurate summary.
- Failed per-item fetches indicate a retryable failure on the item button.
- The script initializes without an API key and prompts when the user tries to act.
- Price-cache lifetime is exposed as a Cache (min) setting (1–120 minutes).
- The floating chip position is clamped to the viewport when restored.
- Accessibility: labels on icon buttons, dialog roles, Escape-to-close, Tab focus trap,
  and keyboard chip repositioning with arrow keys.

### Security and privacy
- In the historical 2.9 release, the source used Torn API v1 with the key in the query
  string; migration to API v2 with an `Authorization` header remained deferred. The
  current v2.9.4 source uses cache-first API v2 price lookup with the existing v1 path
  as a fallback.
- The current source injects a Nunito stylesheet from `fonts.googleapis.com`. The
  script does not send the API key to Google, but the font request is still a
  third-party network request.

### Code quality and tooling
- Fragile Torn selectors are centralized in a `SELECTORS` object with warn-once
  diagnostics.
- Duplicate RW badge/confirm and eye-toggle logic was consolidated, with JSDoc and a
  `debug` storage flag for verbose logging.
- The repository includes ESLint, a Vitest + jsdom suite, and a GitHub Actions CI
  workflow.

### Deferred in the historical 2.9 release
- The 2.9 release deferred a full migration to Torn API v2 because it could not be
  safely verified without live API access. The current v2.9.4 source performs cache-first
  v2 price lookup in batches and retains the v1 endpoint as a fallback.

## 2.8.9

- **PDA API Key Fix**: the PDA placeholder is validated by key format rather than
  string equality, and an injected key is persisted for later runs.
- **Floating Drag Chip**: the embedded Quick Fill / Update All / Settings controls were
  replaced by one floating, draggable chip that switches action by bazaar section and
  remembers its position.

## 2.8.8

- **UI Rebuild**: settings panel and API prompt received a new design treatment.
- **PDA API Key Support**: `###PDA-APIKEY###` injection support was added.
- **RW Detection Refinement**: ranked-war detection was based on glow classes and
  bonus icons.
- **Settings Toggle**: Skip RW Weapons was added to settings.

## 2.8.7 and earlier

Earlier release notes are not included in this file. For historical behavior, consult
the corresponding Git tag or commit.
