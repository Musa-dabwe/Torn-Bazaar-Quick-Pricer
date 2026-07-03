## Torn Bazaar Quick Pricer — v2.8.9 Release Notes

[Install Script](https://update.greasyfork.org/scripts/558562/Torn%20Bazaar%20Quick%20Pricer.user.js)

- **PDA API Key Fix**: Fixed the `###PDA-APIKEY###` injection check so the script no longer re-prompts for a key that was already injected on script update. Key validity is now checked by format instead of comparing against the placeholder text, and the injected key is persisted the first time it's seen.
- **Floating Drag Chip**: Replaced the embedded "Quick Fill" / "Update All" / "Settings" buttons — which could get hidden entirely in desktop-top mode — with a single floating, draggable chip that lives independently of Torn's page layout. The chip automatically switches between Quick Fill and Update All depending on which bazaar page you're on, and remembers its dragged position.

---

## Torn Bazaar Quick Pricer — v2.8.8 Release Notes

- **UI Rebuild**: Replaced settings panel and API prompt with a new brutalist design using the Syne font.
- **PDA API Key Support**: Implemented `###PDA-APIKEY###` injection logic for Torn PDA compatibility.
- **RW Detection Refinement**: Optimized RW weapon detection to use only glow-class and bonus-icon methods.
- **Settings Toggle**: Added "Skip RW Weapons" toggle to settings panel.
