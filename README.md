# Torn Bazaar Quick Pricer

A userscript for [Torn](https://www.torn.com) that fills your bazaar listings with
market-based prices in one click — per item or for the whole page — with configurable
discounting, NPC-floor protection, and ranked-war weapon detection.

**Current version: 2.9.4** — see the [CHANGELOG](CHANGELOG.md) for the release history.

## Features

- **Quick Fill** — fills price and quantity for every item on the *Add items*
  page from live Torn market values, minus your configured discount.
- **Update All** — refreshes the prices of everything already listed on the
  *Manage bazaar* page, asking before applying any price change larger than your
  configured threshold (20% by default). Items priced at $1 (the giveaway/transfer
  convention) are skipped by default.
- **Loaded-row batching** — Torn lazy-loads bazaar rows as you scroll, and batch runs
  process the rows currently loaded in the page (the script never scrolls the page for
  you — that would break Torn's script rules). If more rows may be waiting below the
  fold, the summary tells you to scroll down and run again to cover them.
- **Per-item buttons** — each item row gets its own fill/update button, with one-click
  undo on the add page.
- **NPC floor enforcement** — never prices an item below its NPC sell value
  (can be disabled in settings).
- **RW weapon detection** — rows containing a known ranked-war bonus icon are
  flagged with a blinking rarity dot and skipped by batch runs, since their real
  value isn't the base item's market price. You can still price them manually after
  a confirmation.
- **Route-aware circular bubble** — a 52 px floating bubble works on desktop and
  Torn PDA. Only two Torn bazaar routes are supported: **Add items** and
  **Manage bazaar**. On the base `bazaar.php#/` route, on **Personalize**, and on any
  other route the bubble is hidden and does nothing at all. Tap it for the route
  action, drag it to reposition it (the position is remembered and clamped), or
  long-press for 350 ms to open settings from either supported route.
  - **Add items:** the bubble reads **Fill**; tapping it runs Quick Fill. Once the
    batch settles the bubble switches to a `close` icon, and tapping that clears the
    quantity of every currently loaded row (prices are left alone) and returns the
    bubble to **Fill**. Only loaded rows are touched — Torn lazy-loads the rest, and
    the script never scrolls for you, so scroll down and run again to cover more.
    A route change always resets the bubble to **Fill**.
  - **Manage bazaar:** the bubble shows a `refresh` icon; tapping it runs Update All.
  - The release notes for 2.9.4 open automatically on your first **Add items** visit
    after the update, and once you close them (close button, scrim, or Escape) they
    are not shown again for that version. You can reopen them any time from the info
    button in the settings header.
  - Icons are Material Design assets reviewed from Google's official Material
  source and acquired from the documented Google Fonts CDN URLs; see
  [`docs/assets/material-icons/README.md`](docs/assets/material-icons/README.md)
  for provenance, legacy-serialization details, and Apache License 2.0 attribution.
- **Rate-limit aware** — fresh cache entries are reused without a network request.
  Uncached item IDs are collected into bounded API v2 batches of up to 10, queued
  with 600 ms spacing to stay inside Torn's 100 requests/minute limit, deduplicated,
  cached, and retried with backoff when rate-limited. If a v2 batch has no usable
  expected-schema items, the whole batch falls back to the existing per-item v1
  path. The v2 migration is limited to public price lookup; it does not convert the
  rest of the script.

## Installation

### Tampermonkey / Violentmonkey (desktop browsers)

1. Install [Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/).
2. [Install the script from Greasy Fork](https://update.greasyfork.org/scripts/558562/Torn%20Bazaar%20Quick%20Pricer.user.js)
   — or open `torn-bazaar-quick-pricer.user.js` from this repo's raw view.

### Torn PDA (mobile)

1. In Torn PDA, go to **Settings → Userscripts → Add**.
2. Paste the script source (or load it by URL).
3. Torn PDA injects your API key automatically via its `###PDA-APIKEY###`
   mechanism — no manual key entry needed.

## API key

The script only reads **public item market data**, so a **Public**-level key is all
it needs. Don't paste a Full Access key into any third-party script.

To create one: Torn → **Settings → API Keys → Create Key → Public**.

You'll be prompted for the key on first run; you can change it later by long-pressing
the floating bubble for 350 ms. The key is stored locally in your userscript manager's
storage and is sent only to `api.torn.com`. The current script
also loads the Nunito display font from Google Fonts; it does not send the API key
to that service.

## Settings

Long-press the floating bubble for 350 ms on the **Add items** or **Manage bazaar**
route (the bubble is hidden elsewhere).

The `info` button in the settings header opens the 2.9.4 release notes, which is
also how you reopen them after the first automatic display.

| Setting | Default | Meaning |
| --- | --- | --- |
| API key | — | Your 16-character Torn API key (Public scope is enough). |
| Discount / markup % | 0 | Percentage below market when **Undercut market** is on, or above it when off (0–99.9). |
| Alert at % | 20 | Ask before applying a price change larger than this (0 asks on every change). |
| Cache (min) | 5 | How long fetched prices are reused before re-querying the API (1–120 minutes). |
| NPC floor enforcement | on | Never price below the item's NPC sell value. |
| Skip RW weapons | on | Quick Fill and Update All skip detected ranked-war weapons; per-item buttons still work after confirmation. |
| Skip $1 items | on | Update All leaves $1 (giveaway) listings alone; per-item buttons still work on them. |
| Undercut market | on | On prices below market; off prices above market. The percentage is always entered as a positive value. |
| Clear cache | — | Drops all cached prices immediately. |

## Development

```bash
npm install
npm run lint   # ESLint (flat config, userscript globals)
npm test       # Vitest + jsdom unit tests
```

The script is a single file, `torn-bazaar-quick-pricer.user.js`. A test hook at the
bottom of the IIFE exports its pure helpers to the Node test runner; the hook is
inert in the browser. CI runs lint + tests on every pull request.

Maintenance notes:

- Torn's front-end uses hashed CSS-module classnames. Every fragile selector lives
  in the `SELECTORS` object near the top of the script — if Torn ships a rebuild,
  that's the place to fix.
- The `###PDA-APIKEY###` literal must appear **exactly once** in the file (Torn PDA
  find/replaces every occurrence with the real key). Never compare against the
  token; validate keys by format.
- Set the `debug` flag in userscript storage to enable verbose per-item logging.
- `getBubbleRoute()` deliberately maps every route except Add and Manage to
  `unsupported`; new routes are not added by default because the bubble hides
  itself there and the changelog gate only fires on Add.



## License

[MIT](LICENSE) — © Zedtrooper [3028329]
