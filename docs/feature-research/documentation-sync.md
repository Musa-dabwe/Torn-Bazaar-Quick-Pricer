# Research: Documentation Sync

## Search Terms Used
- `2.9.5`, `2.9.3`, `bubble`, `qp-bubble`, `qp-chip`
- `fonts.googleapis`, `system-ui`, `Nunito`
- `README.md`, `CHANGELOG.md`, `pastel-theme.md`
- userscript metadata and test harness

## Existing Code Found
- `torn-bazaar-quick-pricer.user.js:1-19`: userscript metadata declares version `2.9.3` and targets `bazaar.php` with Torn API permissions.
- `torn-bazaar-quick-pricer.user.js:279-290`: injects a Google Fonts stylesheet for Nunito and creates the `#qp-font` link.
- `torn-bazaar-quick-pricer.user.js:294-592`: implements the pastel design tokens, modal, per-item button, pill-shaped `qp-chip`, toasts, and Nunito font variable.
- `torn-bazaar-quick-pricer.user.js:716-899`: implements the API-key prompt and settings panel, including undercut-market, NPC-floor, RW, `$1`, threshold, and cache settings.
- `torn-bazaar-quick-pricer.user.js:1348-1625`: implements loaded-row batch Quick Fill/Update All, skip rules, confirmation threshold, progress text, and scroll guidance.
- `torn-bazaar-quick-pricer.user.js:1432-1521`: implements the floating pill chip with a drag grip, action button, gear button, keyboard repositioning, and persisted position.
- `torn-bazaar-quick-pricer.user.js:1647-1745`: observes lazily rendered bazaar rows and initializes only after the bazaar container appears.
- `tests/script.test.js:1-273`: tests the pure helpers, settings storage, cache, API-key validation, pricing, quantity parsing, and RW detection.
- `README.md`: documents version `2.9.5`, omits the Undercut market setting, and points to a non-existent `IMPROVEMENT-TASKS.md`.
- `CHANGELOG.md`: documents a `2.9.5` circular-bubble release and says the current UI uses system fonts, neither of which matches the current source.
- `docs/pastel-theme.md`: documents the circular `qp-bubble`, no remote font, `qp-rw-blink`, `qp-spin`, `qp-npc-badge`, and compare-card UI that are not present in the current source.
- `package.json` and `package-lock.json`: project metadata says `2.9.5`, while the userscript metadata says `2.9.3`.

## Similar Patterns
- The source comments explicitly identify the active control as `FLOATING DRAG CHIP`; the current implementation is a pill with a `⋮⋮` grip, not the bubble described by the newer documentation.
- The current source explicitly loads Nunito from `fonts.googleapis.com`; the theme reference must describe that behavior rather than claim a system-only font stack.
- The settings labels and configuration getters are the source of truth for user-facing behavior; the README settings table should include every persisted setting and its actual bounds/defaults.

## New Implementation Required
- No script behavior changes are required. Documentation and project metadata need to be synchronized to the existing `2.9.3` userscript.
- Remove claims describing absent `2.9.5` bubble behavior, changelog modal, pink completion state, and system-font-only design.
- Document the current pill chip, Nunito request, actual settings, and actual per-item/batch behavior.

## Implementation Plan
1. Set the README and package metadata version to `2.9.3` and update the feature/settings descriptions.
2. Make the changelog identify `2.9.3` as the current source version and remove the absent `2.9.5` release section.
3. Correct `docs/pastel-theme.md` to describe the shipped pill chip, Nunito font link, actual keyframes/classes, and implemented components.
4. Run lint/tests and inspect the diff for stale version, bubble, and system-font claims.
