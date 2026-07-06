# Changelog

Releases should be tagged (`v2.9`, …) and published as GitHub Releases when merged
to `main`, so Greasy Fork users can diff versions and roll back easily.

## 2.9 — 2026-07-06

Implementation of the full v2.8.9 code audit (see `IMPROVEMENT-TASKS.md`).

### Reliability
- **Request queue hardened**: 15-second timeout with `ontimeout`/`onabort` handling —
  a hung API request can no longer stall pricing until reload.
- **Torn API error handling**: rate-limit errors (code 5) back off 5 s and retry up to
  twice; fatal errors (2 incorrect key, 8 IP block, 9 API disabled) stop the run and
  notify once instead of alert-spamming per item.
- **Rate-limit compliance**: requests spaced 600 ms apart (≤100 req/min) instead of 300 ms.
- **Request dedupe**: duplicate fetches for the same item piggyback on the in-flight request.
- **Price cache**: held in memory, stale entries pruned at startup, persisted with a
  single debounced write instead of one full re-serialization per item.
- **Bootstrap**: single MutationObserver with a 20 s hard timeout (was observer +
  100 ms poll + fallback observer that could leak forever).
- **Re-injection cleanup**: stale chip/toasts/overlays/stylesheet from a previous
  instance are swept at startup (Torn PDA re-injection, SPA navigation).

### Correctness & input safety
- API key validated with one shared rule (16 alphanumeric) at all three entry points;
  key set via DOM property instead of interpolated into HTML.
- Discount clamped to 0–99.9% — no more negative prices from a typo'd discount.
- "Update All" now awaits each item and reports real updated/skipped/failed counts
  (previously it counted attempts on a fixed 350 ms timer).
- Quantity parsing anchored to the end of the item title so names containing
  "x<digits>" can't be misread.

### UX
- All blocking `alert()`/`confirm()` dialogs replaced with in-page toasts and a
  styled confirm dialog.
- Batch runs show live progress ("Updating 12/50") and an accurate summary toast.
- Failed per-item fetches flash the button red with a retry hint instead of
  silently doing nothing.
- The script now fully initializes without an API key: dismissing the key prompt no
  longer leaves it dead until reload, and saving the first key no longer reloads the page.
- Price-cache lifetime exposed as a "Cache (min)" setting (1–120 minutes).
- Floating chip position is clamped to the viewport when restored (no more off-screen
  chip after switching from a large monitor to a phone).
- Accessibility: aria-labels on icon buttons, `role="dialog"`/`aria-modal`, Escape
  closes dialogs, Tab focus trap, keyboard chip repositioning (arrow keys).

### Security & privacy
- Removed both Google Fonts `@import`s (one was mid-stylesheet and silently ignored);
  UI now uses system font stacks — no third-party requests from the page.
- Added `@noframes` so the script never runs in iframes.
- README documents that a Public-scope API key is sufficient.

### Code quality & tooling
- Centralized all fragile Torn selectors in a `SELECTORS` object with warn-once
  diagnostics.
- Removed dead code (`saveConfig`, `isMobile`, `profilePhoto`, `lastPriceUpdate`,
  `getActiveTab`, `RW_RARITY_KEYWORDS`); deduplicated the RW badge/confirm and
  eye-toggle logic; single `VERSION` source; `debug` flag for verbose logging;
  stylesheet tidied; JSDoc added.
- Repo: renamed the script to the stable `torn-bazaar-quick-pricer.user.js`, deleted
  ~1 MB of unused vendored libraries, added ESLint (flat config), a 30-test
  Vitest + jsdom suite, and a GitHub Actions CI workflow.

### Deferred
- Migration to Torn API v2 with the key in an `Authorization` header (audit task 2.1)
  is deferred: it can't be safely verified without live API access. The script still
  uses the v1 endpoint with the key in the query string.

## 2.8.9

- **PDA API Key Fix**: Fixed the `###PDA-APIKEY###` injection check so the script no
  longer re-prompts for a key that was already injected on script update. Key validity
  is now checked by format instead of comparing against the placeholder text, and the
  injected key is persisted the first time it's seen.
- **Floating Drag Chip**: Replaced the embedded "Quick Fill" / "Update All" /
  "Settings" buttons — which could get hidden entirely in desktop-top mode — with a
  single floating, draggable chip that lives independently of Torn's page layout. The
  chip automatically switches between Quick Fill and Update All depending on which
  bazaar page you're on, and remembers its dragged position.

## 2.8.8

- **UI Rebuild**: Replaced settings panel and API prompt with a new brutalist design
  using the Syne font.
- **PDA API Key Support**: Implemented `###PDA-APIKEY###` injection logic for Torn PDA
  compatibility.
- **RW Detection Refinement**: Optimized RW weapon detection to use only glow-class
  and bonus-icon methods.
- **Settings Toggle**: Added "Skip RW Weapons" toggle to settings panel.
