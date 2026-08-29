# Research: Floating Bubble Refactor

## Search Terms Used
- `createFloatingChip`
- `clampChipPosition`
- `qp-chip`
- `chipEl`
- `chipFillBtn`
- `chipContext`
- `showSettingsPanel`
- `showApiKeyPrompt`
- `apiInput.focus`

## Existing Code Found
- **torn-bazaar-quick-pricer.user.js:1434-1523**: `createFloatingChip()` - creates pill chip with grip, fill button, gear button. Drag handled on grip element only. Position persisted via `GM_setValue('chipPosition')`.
- **torn-bazaar-quick-pricer.user.js:1413-1418**: `clampChipPosition(x, y)` - clamps position to viewport.
- **torn-bazaar-quick-pricer.user.js:1525-1541**: `updateChipContext()` - sets chipContext ('add'|'manage') and button text based on visible items.
- **torn-bazaar-quick-pricer.user.js:279-282**: Cleanup sweep removes `.qp-chip` on re-injection.
- **torn-bazaar-quick-pricer.user.js:764**: `apiInput.focus()` in `showApiKeyPrompt()`.
- **torn-bazaar-quick-pricer.user.js:860**: `apiInput.focus()` in `showSettingsPanel()`.
- **torn-bazaar-quick-pricer.user.js:598-608**: Existing SVG constants (`addButtonSVG`, `refreshSVG`, `eyeSVG`, `eyeOffSVG`, `gearSVG`, `keyBadgeSVG`, `gearBadgeSVG`).
- **torn-bazaar-quick-pricer.user.js:1669**: `createFloatingChip()` called in `initScript()`.
- **torn-bazaar-quick-pricer.user.js:1656**: `updateChipContext()` called in mutation observer callback.

## Similar Patterns
- **Drag logic on grip** (lines 1463-1494): Can be adapted to whole bubble with threshold check.
- **Pointer Events API** used for unified mouse/touch handling - pattern reusable.
- **GM_setValue/GM_getValue** for position persistence - same key pattern (`bubblePosition` instead of `chipPosition`).
- **MutationObserver debounce** (lines 1636-1643) - can call `updateBubbleState()` alongside existing calls.

## New Implementation Required
- **Circular bubble element**: Single div with inline SVG, no child buttons.
- **Drag on whole element**: Threshold-based (5px) to distinguish from tap.
- **Tap/long-press handlers**: 350ms timer, cancel on drag movement.
- **Per-hash icon/background/handlers**: Dynamic based on `window.location.hash`.
- **Fill-state detection**: Check all visible add-items have non-empty, non-zero price inputs.
- **SVG inlining**: Four new constants from docs/assets/.
- **Changelog modal**: New function `showChangelog()` using existing modal pattern.
- **Auto-focus removal**: Delete two `apiInput.focus()` lines.

## Implementation Plan
1. Add bubble state variables and `DRAG_THRESHOLD` constant.
2. Add `clampBubblePosition` and `applyBubblePosition` functions.
3. Replace `createFloatingChip` with `createFloatingBubble` implementing:
   - Drag with threshold
   - Long-press (350ms) + tap detection
   - Hashchange listener
   - Resize position restore
4. Add `updateBubbleState` for per-page logic.
5. Inline four SVG constants.
6. Add `.qp-bubble` CSS rules.
7. Update cleanup sweep to include `.qp-bubble`.
8. Remove `apiInput.focus()` from two modals.
9. Add `CHANGELOG` constant and `showChangelog` function.
10. Refactor `updateAllManagePrices` and `fillAllItems` to remove chip button refs.
11. Update `initScript` and mutation observer to use bubble functions.
12. Test all page states and interactions.