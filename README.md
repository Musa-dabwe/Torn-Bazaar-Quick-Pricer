## Torn Bazaar Quick Pricer — v2.8.8 Release Notes

[Install Script](https://update.greasyfork.org/scripts/558562/Torn%20Bazaar%20Quick%20Pricer.user.js)

- **UI Rebuild**: Replaced settings panel and API prompt with a new brutalist design using the Syne font.
- **PDA API Key Support**: Implemented `###PDA-APIKEY###` injection logic for Torn PDA compatibility.
- **RW Detection Refinement**: Optimized RW weapon detection to use only glow-class and bonus-icon methods.
- **Settings Toggle**: Added "Skip RW Weapons" toggle to settings panel.

---

## Torn Bazaar Quick Pricer — v2.8.7 Release Notes

---

### Settings Panel Redesign

The settings modal has been fully replaced with a classified dossier-styled panel. The new design features a live ticking timestamp, a rotated CONFIDENTIAL stamp, and a subject identity block showing your Torn operator ID. A mugshot area supports uploading a custom profile photo which persists across sessions via Tampermonkey storage. The API key field now has a show/hide eye toggle. Discount and API key are rendered as clean monospace underline inputs. NPC Floor and Skip RW Weapons are toggle switches replacing the previous checkboxes. Footer buttons are labelled AUTHORIZE and ABORT, with CLEAR CACHE as a red bordered stamp. Clicking outside the panel closes it. A subtle flash fires on every button click.

---

### Ranked War Weapon Detection

Added full ranked war weapon detection covering all 70 known RW bonus names sourced from the Torn Wiki and TornExchange, including all General cache bonuses (Yellow, Orange, Red) and all Unique hardcoded weapon bonuses.

Detection reads directly from the `bonus-attachment-{bonusname}` icon class inside `ul.bonuses-wrap li.bonus` — the actual structure Torn uses in the bazaar DOM. Blank slot placeholders and non-bonus icons (damage, accuracy) are explicitly excluded. Rarity colour is read from the `glow-yellow`, `glow-orange`, or `glow-red` class on the item image element.

Detected RW weapons get a small blinking coloured dot to the left of their fill button — gold for Yellow, burnt orange for Orange, red for Red — without displacing the button layout.

**Bulk operations (Quick Fill, Update All)** skip RW weapons by default and report how many were skipped in the completion message.

**Individual per-item buttons** on RW weapons show a confirmation prompt before pricing, identifying the bonus name and rarity tier, since RW weapons carry unique value not reflected in standard market price.

Both behaviours are controlled by the new Skip RW Weapons toggle in Settings.