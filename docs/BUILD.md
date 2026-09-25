# Torn Bazaar Quick Pricer Build Pamphlet

## Overview
- **Purpose**: Userscript for filling and updating Torn bazaar listings with market-based prices.
- **Current Version**: 2.9.3
- **Status**: In active development; API v2 batching implemented and manually verified

## Development Timeline
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
  toasts, and floating pill chip.
- `tests/script.test.js`: Vitest/jsdom tests for pure helpers, settings, cache, pricing,
  item parsing, and ranked-war detection.
- `docs/pastel-theme.md`: reference for the current injected design system and UI
  components.

## Bugs Discovered & Fixed
### Critical
- None known after the user’s manual verification of the real batched fill path. A direct
  v2 response also confirmed the documented field shape for item IDs 206 and 207.

### Medium
- Documentation and project metadata claimed v2.9.5 and circular-bubble behavior while
  the source was v2.9.3 with a pill chip. Fixed by synchronizing documentation and
  package metadata with the source.
- API v2 batch implementation initially allowed a zero-delay scheduler to bypass the
  600 ms spacing window. Fixed with a next-request-time gate and regression tests.
- A v2 response with no parseable values could silently become zero prices. Fixed by
  whole-batch v1 fallback; `sell_price` schema validation was tightened separately.

## Testing Methodology
- Unit/integration testing: Vitest + jsdom, 67 tests.
- Linting: ESLint flat configuration via `npm run lint`.
- Documentation validation: `git diff --check` and source/documentation searches.
- Manual testing: passed. The user installed the local `test.txt` export and confirmed that
  the real userscript fills rows in batches of 10 and is substantially faster than the
  previous sequential behavior. A direct API check also confirmed the v2 field shape.

## AI Models & Their Contributions
### Architecture & Complex Logic
- **Space Bunny Free**: Designed and reviewed the API v2 batching architecture, queue
  integration, schema fallback, and callback isolation under subagent-driven development.

### Code Generation & Refactoring
- **Space Bunny Free**: Implemented the request queue changes, tests, documentation, and
  final review fixes. The userscript remains v2.9.3.

### Specific Implementations
- None.

## Build Outputs
No build artifact was produced. Documentation is maintained in the repository.

## Development Resources
- **Primary IDE**: OpenCode coding agent
- **Version Control**: Git
- **Testing Tools**: Vitest, jsdom, ESLint, GitHub Actions CI

## Future Roadmap
- [ ] Review the Nunito Google Fonts request as a separate product decision.
- [ ] Review dependency audit findings separately.
