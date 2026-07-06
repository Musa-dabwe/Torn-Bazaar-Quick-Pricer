# Code Audit — Torn Bazaar Quick Pricer v2.8.9

Comprehensive audit of `script-v2_8_9.js` (1,255 lines). Each item is an actionable task,
grouped by theme and tagged with a priority:

- **P1** — bugs or risks that can break the script or affect users today
- **P2** — reliability, correctness-hardening, and UX improvements
- **P3** — code quality, maintainability, and repo hygiene

Line references point at `script-v2_8_9.js`.

---

## 1. Critical bugs & correctness (P1)

- [x] **1.1 — Add `ontimeout` / `onabort` handling to the API request queue.** *(Done in v2.9: 15 s timeout + both handlers release the queue.)*
  `GM_xmlhttpRequest` (lines 655–692) only wires `onload` and `onerror`. If a request
  hangs or is aborted, `isProcessingQueue` stays `true` forever and every queued item
  silently never resolves — the whole script's pricing stops until a page reload.
  Add a `timeout` option plus `ontimeout`/`onabort` callbacks that release the queue
  the same way `onerror` does.

- [x] **1.2 — Fix the mid-stylesheet `@import` (it is silently ignored).** *(Done in v2.9: both remote imports removed — see 2.3.)*
  CSS requires all `@import` rules to appear before any other rules. The IBM Plex Mono
  import at line 188 sits in the middle of the stylesheet, so browsers drop it and the
  settings modal falls back to `SFMono-Regular`/`Consolas`. Either move both imports to
  the top of the `<style>` element, or (better — see 2.3) drop remote fonts entirely.

- [x] **1.3 — Stop interpolating the API key into an HTML string.** *(Done in v2.9: set via `apiInput.value`.)*
  `showSettingsPanel()` builds `value="${CONFIG.apiKey}"` via `innerHTML` (line 549).
  The stored key is not guaranteed to be format-valid (see 1.4), so a value containing
  `"` breaks out of the attribute — an HTML-injection vector into the page. Set the
  value via DOM (`apiInput.value = CONFIG.apiKey`) after inserting the markup instead.

- [x] **1.4 — Validate the API key everywhere it is saved, with one shared rule.** *(Done in v2.9: shared `isValidApiKey()` at all three sites.)*
  Three inconsistent standards exist today:
  - the `CONFIG.apiKey` getter validates `/^[a-zA-Z0-9]{16}$/` (line 46);
  - the first-run prompt only checks `key.length === 16` (line 523);
  - the settings panel saves `apiInput.value.trim()` with **no validation at all**
    (line 609), so a typo'd key is persisted and every later request fails.
  Extract one `isValidApiKey()` helper and use it at all three sites, with user
  feedback on rejection.

- [x] **1.5 — Handle Torn API error codes beyond "incorrect key".** *(Done in v2.9: code 5 backs off and retries; codes 2/8/9 halt the queue with one notification; others logged and failed per item.)*
  Only `error.code === 2` is handled (line 662). Code 5 (rate limit) — the most likely
  error during "Update All" on a large bazaar — is treated as a generic failure with no
  backoff and no message, so items silently price to nothing. Handle at least: 5
  (back off and retry), 8/9 (IP block / API disabled — stop the queue and tell the
  user), and surface unknown codes in the UI rather than only `console`.

- [x] **1.6 — Fix the repeated "Incorrect API Key!" alert storm.** *(Done in v2.9: fatal errors flush the queue and notify once.)*
  When the key is bad and N items are queued, the code alerts once per queued request
  (line 663) because the queue keeps draining after the key is cleared. On a bad key,
  flush the remaining queue and alert once.

- [x] **1.7 — Clamp the discount setting.** *(Done in v2.9: `clampDiscount()` 0–99.9 on save and in the calculation; input has min/max.)*
  `calculateFinalPrice()` (line 710) accepts any number the user typed into the
  settings panel. A discount over 100 produces a **negative price** written straight
  into Torn's price inputs; a large negative discount produces an absurdly high one.
  Clamp to a sane range (e.g. 0–99.9) on save and/or in the calculation, and add
  `min`/`max` attributes to the input (line 555).

- [x] **1.8 — Make `updateAllManagePrices()` actually await each update.** *(Done in v2.9: promise-based with `'updated'|'declined'|'failed'` statuses and real counts.)*
  The loop (lines 945–948) fires `updateManageItemPrice()` (async via callback) and
  then just waits a fixed 350 ms. Slow API responses overlap with the next item, the
  final "Updated N item prices!" counts *attempts* rather than successes (declined
  confirms and failed fetches still count), and blocking `confirm()` dialogs freeze
  mid-batch. Refactor `updateManageItemPrice` to return a Promise that resolves with
  a success/skip/fail status, await it, and report real numbers.

- [x] **1.9 — Dedupe in-flight requests for the same item.** *(Done in v2.9: `pendingRequests` map; extra callbacks piggyback.)*
  `fetchItemData()` (line 695) checks the cache but not the queue: several visible
  stacks of the same item queue several identical API calls. Track pending item IDs
  and attach additional callbacks to the in-flight request instead of re-queueing.

- [x] **1.10 — Don't leave the script dead when the API-key prompt is dismissed.** *(Done in v2.9: full init always; actions prompt for a key on demand.)*
  If there's no key, `initScript()` shows the prompt and returns (line 1197) without
  creating the chip or observer. If the user cancels the prompt, the script is inert
  until a full reload with no way to reopen settings. Create the chip regardless and
  let its gear button reopen the key prompt.

## 2. Security & privacy (P2)

- [ ] **2.1 — Move the API key out of the URL query string.**
  Requests use `?...&key=${apiKey}` (line 657). Query strings end up in proxy and
  server logs. Torn API v2 accepts the key via the `Authorization: ApiKey <key>`
  header — migrate to v2 (`api.torn.com/v2/...`) or at minimum document why v1 is
  required.

- [ ] **2.2 — Recommend/verify minimal API key scope.**
  The script only needs public item market data. Document (README + key prompt) that
  a **Public**-level key is sufficient, so users don't paste full-access keys into a
  third-party script.

- [x] **2.3 — Remove remote Google Fonts imports.** *(Done in v2.9: system font stacks.)*
  Two `@import url('https://fonts.googleapis.com/...')` calls (lines 140, 188) leak
  every bazaar page visit to Google, add a render dependency on a third-party CDN,
  and one of them doesn't even load (see 1.2). Fall back to system font stacks, or
  embed the fonts as data URIs if the aesthetic matters.

- [x] **2.4 — Add `@noframes` to the userscript header.** *(Done in v2.9.)*
  Without it the script can also run in iframes matching `bazaar.php*`, duplicating
  the chip, observers, and API traffic.

## 3. Reliability & robustness (P2)

- [x] **3.1 — Centralize Torn DOM selectors in one place.** *(Done in v2.9: `SELECTORS` object + `warnSelectorMiss()` diagnostics.)*
  Hashed CSS-module classnames (`item___UN3Mg`, `item___GYCYJ`, `item___khvF6`,
  `itemsContainner___`, `rowItems___`, `glow-*`, `bonus-attachment-*`) are scattered
  across ~10 functions. One Torn front-end rebuild changes the hashes and breaks the
  script in many places at once. Collect them into a single `SELECTORS` object so a
  breakage is a one-spot fix, and log a clear diagnostic when a selector matches
  nothing.

- [x] **3.2 — Simplify and bound the triple bootstrap in `checkForBazaar()`.** *(Done in v2.9: single observer with a 20 s hard timeout.)*
  Lines 1215–1251 run a MutationObserver **and** a 100 ms polling interval **and** a
  fallback documentElement observer for the same goal. The poll gives up after 5 s but
  the body observer runs forever if the bazaar root never appears (e.g. wrong page
  state) — a permanent observer leak. Pick one mechanism (observer with a timeout
  that disconnects it) and remove the poll.

- [x] **3.3 — Disconnect observers / remove listeners on re-injection.** *(Done in v2.9: startup sweep of `#qp-style`/`.qp-chip`/`.qp-toast-wrap`/`.qp-overlay`; observer refs kept and disconnected before reuse.)*
  `createFloatingChip()` sweeps orphaned `.qp-chip` elements (line 994) but the
  `resize` listener (line 1051), the bazaar-root MutationObserver (line 1193), and
  the injected `<style>` element are never cleaned up. On PDA re-injection these
  accumulate. Keep references and add a small teardown path (or a guard against
  double-injection at the top of the IIFE).

- [x] **3.4 — Clamp the restored chip position to the current viewport.** *(Done in v2.9.)*
  `applyChipPosition()` (line 978) restores the saved coordinates verbatim. A position
  saved on a large monitor restores off-screen on a phone until the next `resize`
  event fires. Run the saved position through `clampChipPosition()` on restore.

- [x] **3.5 — Respect Torn's API rate limit in the queue.** *(Done in v2.9: 600 ms spacing + code-5 backoff.)*
  The queue spaces requests 300 ms apart (line 685) ≈ 200 req/min, double Torn's
  100 req/min limit; large "Update All" runs will hit code-5 errors. Either raise the
  spacing to ≥ 600 ms, or implement adaptive backoff on error code 5 (pairs with 1.5).

- [x] **3.6 — Harden `getQuantity()` against false matches.** *(Done in v2.9: regex anchored to end of title.)*
  The `/x(\d+)/i` regex over the whole title text (line 639) can match item names that
  legitimately contain `x<digits>`. Anchor the match to the known quantity markup or
  the end of the string (e.g. `/\bx(\d+)\s*$/i`).

- [x] **3.7 — Surface fetch failures to the user in the Add-items flow.** *(Done in v2.9: red flash + retry hint on the button.)*
  In `fillItemPrice()` a failed fetch resolves silently with `marketValue: 0`
  (lines 754–781): the button un-disables and nothing happens, with no explanation.
  Show a brief error state on the button (e.g. red flash + title text) when pricing
  fails.

- [x] **3.8 — Cap / prune the persisted price cache.** *(Done in v2.9: stale entries pruned at startup; writes debounced into one `GM_setValue`.)*
  `priceCache` (line 56) only ever grows; every write serializes the entire object
  through `GM_setValue` once per priced item (O(n²) during batch runs). Prune entries
  older than `cacheTimeout` on startup, and batch cache writes during
  `fillAllItems()` / `updateAllManagePrices()` (collect, then write once).

## 4. UX & accessibility (P2–P3)

- [x] **4.1 — Replace blocking `alert()`/`confirm()` with in-page UI.** (P2) *(Done in v2.9: `qpToast` + async `qpConfirm`; zero native dialogs left.)*
  Nine call sites use native dialogs. They freeze batch runs (see 1.8), look jarring
  inside Torn, and on PDA render as OS dialogs. Build a small toast + confirm
  component in the existing modal style.

- [x] **4.2 — Avoid full `location.reload()` after saving the first API key.** (P3) *(Done in v2.9.)*
  Line 526 reloads the page; the script could simply proceed to `initScript()`.

- [x] **4.3 — Add keyboard & screen-reader accessibility to the modals and chip.** (P3) *(Done in v2.9: aria-labels, `role="dialog"`/`aria-modal`, Escape close, Tab trap, arrow-key chip movement.)*
  Icon-only buttons (gear, refresh, add, eye toggle) have `title` but no
  `aria-label`; the overlays have no focus trap, no `role="dialog"`, and don't close
  on Escape; the drag grip isn't keyboard-operable.

- [x] **4.4 — Show progress during batch runs.** (P3) *(Done in v2.9: "Updating 12/50" / "Filling 12/50" on the chip.)*
  "Updating…" / "Filling…" is all the feedback there is. With 50+ items a run takes
  30+ seconds; show a counter ("12/50") on the chip button.

- [x] **4.5 — Make `cacheTimeout` a visible setting.** (P3) *(Done in v2.9: "CACHE (MIN)" field, 1–120 minutes.)*
  The 5-minute cache (line 64) is invisible to users, who may believe "Update All"
  re-fetched live prices when it served cached ones. Either expose it in settings or
  show a "prices as of…" hint.

## 5. Code quality & dead code (P3)

- [x] **5.1 — Delete dead code.** *(Done in v2.9: all five removed.)*
  - `saveConfig()` no-op (line 466) and its one call site (line 665);
  - `isMobile` (line 464) — computed, never read;
  - `CONFIG.profilePhoto` getter/setter (lines 62–63) — never used;
  - the bare `getActiveTab()` call inside `getVisibleItems()` (line 799) — return
    value discarded (and `getActiveTab` itself is then unused);
  - `CONFIG.lastPriceUpdate` (lines 54–55) — written on every fetch, reset by "clear
    cache", never read for any decision.

- [x] **5.2 — Single source of truth for the version string.** *(Done in v2.9: `VERSION` const from `GM_info`.)*
  "2.8.9" appears in the metadata block (line 4), the startup log (line 28), and the
  settings footer (line 581). Add a `const VERSION` (read `GM_info.script.version`
  where available) and reference it.

- [x] **5.3 — Deduplicate the RW-detection + button-building logic.** *(Done in v2.9: shared `buildItemButton()` + `confirmRwPricing()`.)*
  `addUpdatePriceButton()` (lines 848–897) and `addQuickPriceButton()` (lines
  1086–1143) share ~40 lines of near-identical dot/button/confirm construction, and
  the RW confirm message string is duplicated verbatim. Extract shared helpers
  (`buildRwBadge()`, `confirmRwPricing()`).

- [x] **5.4 — Deduplicate the eye-toggle wiring.** *(Done in v2.9: shared `wireEyeToggle()`, now keyboard-operable too.)*
  The show/hide-key toggle is implemented twice, identically, in `showApiKeyPrompt()`
  and `showSettingsPanel()` (lines 515–519, 593–597). Extract `wireEyeToggle(overlay)`.

- [x] **5.5 — Reduce repeated `GM_getValue` deserialization in CONFIG getters.** *(Done in v2.9: in-memory `settingsCache` with write-through setters; price cache held in memory.)*
  Every `CONFIG.priceCache` / `CONFIG.skipRwWeapons` read hits storage (and for the
  cache, deserializes the whole object). In hot paths (`fetchItemData` per item) this
  is wasteful. Cache reads in memory and write through on set.

- [x] **5.6 — Add a debug flag for console logging.** *(Done in v2.9: `debug` storage flag gates `log()`.)*
  Per-item `console.log` calls (RW detection, NPC floor adjustments) are noisy in
  normal use. Gate them behind a `CONFIG.debug` setting with a tiny `log()` helper.

- [x] **5.7 — Tidy the stylesheet.** *(Done in v2.9: merged duplicate `.qp-modal` blocks, removed dead/redundant rules.)*
  `.qp-modal` is declared twice (lines 190 and 212 — variables block vs. layout
  block); several `border-radius: 0 !important` rules repeat what `.qp-btn` already
  sets; and the `!important` density makes future overrides painful. Consolidate.

- [x] **5.8 — Add JSDoc to the non-obvious functions.** *(Done in v2.9.)*
  `getRWBonusInfo`, `calculateFinalPrice`, `fetchItemData`, `findSectionContainer`,
  and the CONFIG getters (especially the PDA-key dance, which already has a good
  comment) would benefit from typed JSDoc for editor support.

## 6. Repo hygiene & tooling (P3)

- [x] **6.1 — Explain or remove the `script/` directory.** *(Done in v2.9: folder deleted.)*
  It contains vendored third-party libraries (jQuery 1.8.2, jQuery UI, centrifuge,
  polyfills…) that the userscript never references. If they're reference copies of
  Torn's page scripts, say so in a README inside the folder; otherwise delete them —
  they're ~1 MB of unexplained code in a userscript repo (and jQuery 1.8.2 has known
  CVEs, which looks bad in the repo even if unused).

- [x] **6.2 — Use a stable filename for the script.** *(Done in v2.9: renamed to `torn-bazaar-quick-pricer.user.js`.)*
  `script-v2_8_9.js` bakes the version into the filename, so every release breaks
  links and loses per-file git history (`git log --follow` aside). Rename to
  `torn-bazaar-quick-pricer.user.js` (the `.user.js` suffix also enables one-click
  install from the raw GitHub URL) and keep the version only in the metadata block.

- [ ] **6.3 — Add ESLint + a userscript-aware config.**
  A minimal `package.json` with ESLint (`no-unused-vars` alone would have caught
  5.1) and the `userscripts` env for `GM_*` globals. Run it in a GitHub Action on PRs.

- [ ] **6.4 — Add unit tests for the pure logic.**
  `calculateFinalPrice`, `rwSkipLabel`, the API-key format check, item-ID extraction
  from image URLs, and `getQuantity` parsing are all pure and trivially testable with
  Vitest/Jest + jsdom once extracted (pairs with 3.1/5.3 refactors).

- [ ] **6.5 — Expand the README beyond release notes.**
  Add: what the script does (with a screenshot), installation for Tampermonkey and
  Torn PDA, how to create an appropriately-scoped API key, settings reference, and a
  short contributing/development section. Move version history to `CHANGELOG.md`.

- [ ] **6.6 — Add a CHANGELOG and tag releases.**
  Git tags per version plus GitHub Releases would let Greasy Fork users diff what
  changed and make rollbacks trivial.

---

## Suggested implementation order

1. **Quick wins, no behavior risk:** 5.1, 5.2, 1.2, 2.4, 6.2 (one sitting).
2. **Queue hardening:** 1.1, 1.5, 1.6, 1.9, 3.5 — one focused PR around
   `processRequestQueue` / `fetchItemData`.
3. **Input safety:** 1.3, 1.4, 1.7.
4. **Batch-update correctness:** 1.8, 3.7, 4.1, 4.4.
5. **Structural refactors:** 3.1, 5.3, 5.5, then tests (6.4) on the extracted logic.
6. **Everything else** as time allows.
