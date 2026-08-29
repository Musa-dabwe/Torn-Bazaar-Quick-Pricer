# Session: 2026-08-29 18:30
**Duration**: 18:30 - 19:45
**Project**: Torn-Bazaar-Quick-Pricer

## Objective
Refactor the existing pill-shaped floating chip (`.qp-chip`) into a circular floating bubble (`.qp-bubble`) with per-page icon identity, tap/long-press interactions, and drag-and-drop persistence.

## Research Phase
- Explored `torn-bazaar-quick-pricer.user.js` to understand the existing chip implementation (`createFloatingChip`, `clampChipPosition`, drag logic on grip element).
- Identified all references to chip elements (`chipEl`, `chipFillBtn`, `chipContext`) across the codebase.
- Located SVG constants section for inlining new bubble icons.
- Found `showSettingsPanel` and `showApiKeyPrompt` functions where `apiInput.focus()` needed removal.

## Implementation Steps
1. **Added bubble state variables** (lines 1432-1438): `bubbleEl`, `bubbleTapHandler`, `bubbleLongPressHandler`, `bubbleContext`, `DRAG_THRESHOLD`.
2. **Added `clampBubblePosition` and `applyBubblePosition`** (lines 1440-1456) mirroring chip logic but for bubble element.
3. **Implemented `createFloatingBubble`** (lines 1459-1543): Creates circular bubble, attaches drag (threshold 5px) and tap/long-press (350ms) handlers, listens to hashchange, restores persisted position on resize.
4. **Implemented `updateBubbleState`** (lines 1546-1587): Switches icon/background/handlers based on `window.location.hash` (#/, #/add, #/manage, #/personalize). Fill-state detection for add page.
5. **Inlined SVG constants** (lines 610-614): `INFO_SVG`, `BOX_OPEN_FULL_SVG`, `BOX_OPEN_SVG`, `ROTATE_SQUARE_SVG`.
6. **Added `.qp-bubble` CSS** (lines 578-595): 52x52px, border-radius 50%, flex center, drag/hover states.
7. **Updated cleanup sweep** (line 281): Added `.qp-bubble` to selector list.
8. **Removed `apiInput.focus()`** from `showApiKeyPrompt` (was line 764) and `showSettingsPanel` (was line ~860).
9. **Added `CHANGELOG` constant and `showChangelog` modal** (lines 32-44, 922-955).
10. **Refactored `updateAllManagePrices`** (lines 1373-1421): Removed chip button references, simplified progress display.
11. **Refactored `fillAllItems`** (lines 1637-1687): Removed chip button references, calls `updateBubbleState()` on completion.
12. **Updated `initScript` and mutation observer** (lines 1647-1660): Call `createFloatingBubble()` and `updateBubbleState()` instead of chip equivalents.
13. **Updated `fillAllItemsOrPromptApiKey`** (lines 1610-1612) to call new `fillAllItems`.

## Bugs Discovered & Fixed
- **Bug #1**: Long-press timer not cancelled when drag movement exceeded threshold, causing both drag and long-press to fire.
  - Root cause: Drag logic and long-press timer were independent; drag didn't clear the timer.
  - Fix: Added `dragMoved` flag and clear `longPressTimer` in `pointermove` when threshold exceeded.
  - File: `torn-bazaar-quick-pricer.user.js`, lines 1488-1505
  - Status: FIXED

- **Bug #2**: Bubble remained hidden after navigating away from `#/personalize` because `display:none` wasn't reset.
  - Root cause: `updateBubbleState` only set `display:none` for personalize but didn't restore `display:flex` for other hashes.
  - Fix: Added `bubbleEl.style.display = 'flex'` at start of `updateBubbleState`.
  - File: `torn-bazaar-quick-pricer.user.js`, line 1549
  - Status: FIXED

## Testing Performed
- **Unit Tests**: Existing test suite (`npm test` / `tests/script.test.js`) passes.
- **Integration Tests**: Manual verification in browser (Tampermonkey) on Torn bazaar pages:
  - Main page (#/): bubble shows info icon, tap opens changelog, long-press opens settings.
  - Add page (#/add): bubble shows box-open-full, tap triggers Quick Fill, icon updates when all items filled.
  - Manage page (#/manage): bubble shows rotate-square, tap runs Update All, long-press opens settings.
  - Personalize page (#/personalize): bubble hidden, reappears on hash change.
  - Drag: bubble draggable anywhere, position persists across reloads.
  - Settings/API key modals: no auto-focus on open, focus trap still works.
- **Regression Testing**: Verified pricing logic, API queue, mutation observer, item buttons unchanged.

## AI Models Used & Their Role
- **Claude Opus 4.8**: Architecture decisions, refactor planning, complex drag/long-press interaction design.
  - Tasks: Overall design, threshold logic, state management, bug diagnosis.
  - Tokens Used: ~15k
  - Effectiveness: High - provided clear bounded design and caught edge cases.

- **Claude Sonnet**: Code generation for repetitive edits, CSS, SVG inlining.
  - Tasks: Template literal creation, CSS rule additions, boilerplate function updates.
  - Tokens Used: ~8k
  - Effectiveness: High - fast accurate edits.

## Key Decisions Made
- **Drag threshold 5px**: Balances easy drag on touch with tap detection.
- **`display:none` for personalize**: Keeps element in DOM for instant restore on hash change.
- **Inline SVGs**: Required for userscript sandbox (no external asset loading).
- **Removed auto-focus**: Improves UX on mobile/PDA where keyboard shouldn't auto-open.

## Build Outputs Generated
Path: ~/storage/shared/Docs/Build/scripts/
Files created:
- torn-bazaar-quick-pricer-v2.9.3-20260829.user.js (copied from working directory)

## Issues & Blockers
- None remaining.

## Performance Metrics
- Script size: ~42 KB (was ~40 KB, +2 KB for new SVG constants and logic).
- No measurable runtime overhead; drag/long-press use native pointer events.

## Next Session Priorities
- [ ] Monitor for any edge cases in hashchange handling on SPA navigation.
- [ ] Consider adding keyboard accessibility for bubble (arrow keys to move).
- [ ] Verify compatibility with Torn's future UI changes.

## Related Sessions
- See also: session-2026-08-29-1430-initial-analysis.md (if exists)
- Continuation of: N/A (first session on this refactor)