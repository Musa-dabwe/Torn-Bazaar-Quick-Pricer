# Torn Bazaar Quick Pricer Build Pamphlet

## Overview
- **Purpose**: Userscript for filling and updating Torn bazaar listings with market-based prices.
- **Current Version**: 2.9.4
- **Status**: v2.9.4 current (bubble follow-up documented); API v2 batching/manual
  verification completed; live desktop/PDA smoke test pending as a release gate

## Development Timeline
### 2026-09-26 — v2.9.4 bubble follow-up completed and documented
Session: [session-2026-09-26-v2.9.4-bubble-followup.md](sessions/session-2026-09-26-v2.9.4-bubble-followup.md)
Brief: Restricted the bubble to the Add and Manage routes (the base `bazaar.php#/` route
and Personalize hide it), replaced the Add inventory icon with a text **Fill** state that
becomes a `close` clear-all action after a batch, gated the 2.9.4 changelog to a
once-per-version automatic dialog on the first Add visit, added the settings-header info
action that reopens it, added the settings-icon drag hint, removed the unused
`inventory_2`/`more_vert` icons, and synchronized README, CHANGELOG, theme reference, and
build records. No pricing, quantity-parsing, API v2 batching, or v1 fallback behavior
changed; the live desktop/PDA smoke test is still a pending release gate.

### 2026-09-25 — v2.9.4 Material 3 bubble release prepared
Session: [session-2026-09-25-v2.9.4-material3-bubble.md](sessions/session-2026-09-25-v2.9.4-material3-bubble.md)
Brief: Restored the route-aware circular bubble and long-press gestures, centralized
reviewed Material 3 icons with source attribution, verified PDA initialization and
no-focus dialogs, retained API v2 batching with v1 fallback, and aligned all current
release metadata and documentation to v2.9.4.

### 2026-09-25 — API v2 batch pricing implemented
Session: [session-2026-09-25-1148-api-v2-batch-pricing.md](sessions/session-2026-09-25-1148-api-v2-batch-pricing.md)
Brief: Added cache-first 10-ID API v2 batches, 600 ms serialized spacing, v1 fallback,
schema-shape detection, callback isolation, and regression coverage. Live Public-key
verification remains pending.

### 2026-09-25 — Documentation synchronized with v2.9.3 source
Session: [session-2026-09-25-0852-sync-documentation-with-userscript.md](sessions/session-2026-09-25-0852-sync-documentation-with-userscript.md)
Brief: Removed documentation for the unsupported v2.9.5 circular-bubble refactor,
documented the current pill chip and Nunito request, added the missing Undercut market
setting, and aligned package metadata to v2.9.3.

## Architecture Overview
- `torn-bazaar-quick-pricer.user.js`: single-file userscript with Torn API request queue,
  price cache, bazaar DOM observation, per-item controls, batch actions, settings modal,
  toasts, and route-aware circular bubble.
- `tests/script.test.js`: Vitest/jsdom tests for pure helpers, settings, cache, pricing,
  item parsing, ranked-war detection, bubble behavior, PDA initialization, and dialogs.
- `docs/pastel-theme.md`: reference for the current injected design system and UI
  components.

## Bugs Discovered & Fixed
### Critical
- None known after the user’s manual verification of the real batched fill path. A direct
  v2 response also confirmed the documented field shape for item IDs 206 and 207.

### Medium
- The v2.9.4 bubble originally opened the changelog from the base `bazaar.php#/` route,
  which showed UI where no bubble is rendered and marked the version seen, so the user
  would never see the notes on the first real Add visit. Fixed by gating the changelog on
  the Add route inside `maybeShowChangelog()`.
- The drag-hint render branch removed `qp-bubble-hidden`, which could reveal the bubble
  on an unsupported route mid-drag. Fixed by checking the route before the drag branch.
- The post-fill `clear` state survived a hash change, offering to clear quantities the
  user may already have cleared. Fixed by resetting the bubble mode on `hashchange`.
- Clearing quantities could blank a checkbox input that the quantity-checkbox selector
  had missed, corrupting its checked state. Fixed by excluding `input[type=checkbox]`.
- Documentation and project metadata claimed v2.9.5 and circular-bubble behavior while
  the source was v2.9.3 with a pill chip. Fixed by synchronizing documentation and
  package metadata with the source.
- API v2 batch implementation initially allowed a zero-delay scheduler to bypass the
  600 ms spacing window. Fixed with a next-request-time gate and regression tests.
- A v2 response with no parseable values could silently become zero prices. Fixed by
  whole-batch v1 fallback; `sell_price` schema validation was tightened separately.

## Testing Methodology
- Unit/integration testing: Vitest + jsdom, 168 tests (all passing).
- Linting: ESLint flat configuration via `npm run lint`.
- Documentation validation: `git diff --check` and source/documentation searches.
- Manual testing: API v2 batching/manual verification passed: the user installed the
  local `test.txt` export and confirmed the real userscript fills rows in batches of 10;
  a direct API check also confirmed the v2 field shape. The final live desktop/PDA smoke
  test remains pending and is a release gate. The v2.9.4 bubble follow-up
  (route restriction, Fill/clear states, changelog gate, settings info action) was
  verified by unit tests only; the live desktop/PDA smoke test for the follow-up is
  still pending and blocks release.

## AI Models & Their Contributions
### Architecture & Complex Logic
- **Space Bunny Free**: Designed and reviewed the API v2 batching architecture, queue
  integration, schema fallback, and callback isolation under subagent-driven development.
- **Space Bunny Free**: Designed the v2.9.4 bubble follow-up (unsupported-route
  decision, two-state Add bubble, once-per-version changelog gate) and reviewed the
  implementation.

### Code Generation & Refactoring
- **Space Bunny Free**: Implemented the request queue changes, tests, documentation, and
  final review fixes. Task 3 aligned the userscript and package metadata to v2.9.4.

### Specific Implementations
- **Space Bunny Free**: Implemented the v2.9.4 bubble follow-up and its regression tests,
  then updated README, CHANGELOG, the theme reference, research record, and session log.

## Build Outputs
No build artifact was produced. Documentation is maintained in the repository.

## Development Resources
- **Primary IDE**: OpenCode coding agent
- **Version Control**: Git
- **Testing Tools**: Vitest, jsdom, ESLint, GitHub Actions CI

## Future Roadmap
- [ ] Review the Nunito Google Fonts request as a separate product decision.
- [ ] Review dependency audit findings separately.
