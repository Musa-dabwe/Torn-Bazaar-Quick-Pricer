# Torn Bazaar Quick Pricer Build Pamphlet

## Overview
- **Purpose**: Userscript for filling and updating Torn bazaar listings with market-based prices.
- **Current Version**: 2.9.3
- **Status**: Documentation synchronized with current userscript source

## Development Timeline
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
- None in this documentation-only session.

### Medium
- Documentation and project metadata claimed v2.9.5 and circular-bubble behavior while
  the source was v2.9.3 with a pill chip. Fixed by synchronizing documentation and
  package metadata with the source.

## Testing Methodology
- Unit testing: Vitest + jsdom, 42 tests.
- Linting: ESLint flat configuration via `npm run lint`.
- Documentation validation: `git diff --check` and source/documentation searches.
- Manual testing: not required for this documentation-only update.

## AI Models & Their Contributions
### Architecture & Complex Logic
- **Space Bunny Free**: Compared the userscript's actual metadata, DOM behavior, settings,
  request flow, and CSS with the existing docs; identified version and feature drift.

### Code Generation & Refactoring
- **Space Bunny Free**: Updated README, changelog, theme reference, package metadata, and
  session records; no application source code was changed.

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
