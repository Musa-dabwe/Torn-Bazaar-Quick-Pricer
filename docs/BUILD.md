# Torn Bazaar Quick Pricer Build Pamphlet

## Overview
- **Purpose**: Tampermonkey userscript that auto-fills Torn Bazaar item prices using Torn API market data. Optimized for PDA/mobile layout.
- **Current Version**: 2.9.3
- **Status**: In Active Development

## Development Timeline
### 2026-08-29 - Floating Bubble Refactor
**Session**: [docs/sessions/session-2026-08-29-1830-floating-bubble-refactor.md](docs/sessions/session-2026-08-29-1830-floating-bubble-refactor.md)
**Brief**: Replaced pill-shaped floating chip with circular bubble icon featuring per-page identity, tap/long-press actions, and drag persistence.

## Architecture Overview
The script injects into `https://www.torn.com/bazaar.php*` and consists of:
- **Price Cache**: In-memory + `GM_setValue` persisted cache with TTL.
- **API Request Queue**: Rate-limited (600ms spacing) GM_xmlhttpRequest wrapper with retry logic.
- **DOM Observers**: MutationObserver debounced at 300ms to detect new item rows.
- **UI Components**:
  - Per-item price buttons (`.qp-item-btn`) injected into bazaar rows.
  - Floating bubble (`.qp-bubble`) - circular, draggable, persistent position.
  - Settings/API key modals (`.qp-overlay` + `.qp-modal`) with focus trap.
  - Toast notifications (`.qp-toast-wrap`).
- **SVG Icons**: All inlined as template literals for userscript sandbox compatibility.
- **Settings**: Stored via `GM_setValue`, cached in `settingsCache` object.

## Bugs Discovered & Fixed
### Critical
- None in this session.

### Medium
- **Bug #1 - Long-press fires during drag**: Long-press timer wasn't cancelled when drag movement exceeded threshold. Fixed by clearing timer in `pointermove` when drag threshold crossed.
- **Bug #2 - Bubble stays hidden after personalize**: `updateBubbleState` didn't reset `display:none` when navigating away from `#/personalize`. Fixed by setting `display:flex` at function start.

## Testing Methodology
- **Unit Testing**: Jest-based tests in `tests/script.test.js` covering price calculation, cache, API key validation.
- **Integration Testing**: Manual end-to-end on live Torn bazaar pages via Tampermonkey:
  - All four hash states (#/, #/add, #/manage, #/personalize)
  - Drag, tap, long-press interactions
  - Settings and API key modal flows
  - Fill-all and update-all operations
- **Manual Testing**: Chrome (Tampermonkey) and Android PDA (Kiwi Browser + userscript).
- **Regression Testing**: Existing pricing logic, API queue, cache, item buttons verified unchanged.

## AI Models & Their Contributions
### Architecture & Complex Logic
- **Claude Opus 4.8**: Refactor design, drag/long-press state machine, bounded task planning, bug diagnosis.
  - Tasks: Overall design, threshold logic, state management, edge case analysis.
  - Tokens Used: ~15k
  - Effectiveness: High

### Code Generation & Refactoring
- **Claude Sonnet**: Template literals, CSS rules, boilerplate function updates, repetitive edits.
  - Tasks: SVG inlining, CSS additions, function rewrites, cleanup sweep updates.
  - Tokens Used: ~8k
  - Effectiveness: High

## Build Outputs
Location: `~/storage/shared/Docs/Build/scripts/`
- `torn-bazaar-quick-pricer-v2.9.3-20260829.user.js`

## Development Resources
- **Primary IDE**: AndroidIDE + Termux
- **Version Control**: Git (GitHub: Musa-dabwe/Torn-Bazaar-Quick-Pricer)
- **Testing Tools**: Tampermonkey (desktop), Kiwi Browser + userscript (Android PDA), Jest (unit)
- **Documentation**: `docs/` directory with sessions, feature research, BUILD.md

## Future Roadmap
- [ ] Add keyboard accessibility for bubble (arrow key repositioning).
- [ ] Monitor Torn UI changes for selector breakage.
- [ ] Consider adding price history graph modal.
- [ ] Optimize API cache invalidation strategy.
- [ ] Add export/import settings feature.