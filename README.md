# Torn Bazaar Quick Pricer

A userscript for [Torn](https://www.torn.com) that fills your bazaar listings with
market-based prices in one click — per item or for the whole page — with configurable
discounting, NPC-floor protection, and ranked-war weapon detection.

**Current version: 2.9.1** — see the [CHANGELOG](CHANGELOG.md) for what's new.

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
- **RW weapon detection** — ranked-war weapons (glow + bonus icon detection) are
  flagged with a blinking badge and skipped by batch runs, since their real value
  isn't the base item's market price. You can still price them manually after a
  confirmation.
- **Floating chip** — a draggable control chip that works on any Torn layout
  (desktop or mobile) and remembers where you put it. It switches between
  Quick Fill and Update All automatically based on the page you're on.
- **Rate-limit aware** — API requests are queued, spaced to stay inside Torn's
  100 requests/minute limit, deduplicated, cached, and retried with backoff when
  rate-limited.

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

You'll be prompted for the key on first run; you can change it later from the
settings panel (gear icon on the floating chip). The key is stored locally in your
userscript manager's storage and sent only to `api.torn.com`.

## Settings

Open with the gear icon on the floating chip.

| Setting | Default | Meaning |
| --- | --- | --- |
| API key | — | Your 16-character Torn API key (Public scope is enough). |
| Discount % | 0 | Percentage knocked off the market value (0–99.9). |
| Alert at % | 20 | Ask before applying a price change larger than this (0 asks on every change). |
| Cache (min) | 5 | How long fetched prices are reused before re-querying the API (1–120 minutes). |
| NPC floor enforcement | on | Never price below the item's NPC sell value. |
| Skip RW weapons | on | Batch runs skip detected ranked-war weapons. |
| Skip $1 items | on | Update All leaves $1 (giveaway) listings alone; per-item buttons still work on them. |
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

An audit-driven task list lives in [IMPROVEMENT-TASKS.md](IMPROVEMENT-TASKS.md);
almost all of it shipped in v2.9.

## License

[MIT](LICENSE) — © Zedtrooper [3028329]
