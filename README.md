# Torn Bazaar Quick Pricer
Author: `Zedtrooper [3028329]`
Current Version: `2.8.3`

This is a Tampermonkey userscript for the text-based RPG Torn. It streamlines the experience of running a Bazaar by automatically fetching market values via the Torn API. It allows you to price your items competitively with a single click, both when adding new stock and when managing existing listings.

## Main Changes in v2.8.3

 * Undo Functionality: The individual "Quick Add" buttons now feature a smart toggle. After automatically filling an item's price and quantity, the button turns Red. Clicking it again will "Undo" the action, clearing both the price and quantity fields instantly.
 * NPC Price Safety Toggle: A new checkbox has been added to the Settings panel: "Disable NPC Safety Limit".
   * Default (Unchecked): The script prevents you from listing an item for less than you could sell it to a game shop (NPC).
   * Checked: You can override this safety measure if you wish to apply deep discounts that drop the price below the NPC sell value.
   * Info Icon: Added a clickable info icon in settings to explain this feature.
 * Mobile Optimizations:
   * The "Update All" button is now hidden on mobile devices (like Torn PDA) to save screen space, while the Settings button remains accessible.
   * Fixed a bug that caused buttons to duplicate on the "Manage Bazaar" page.
Key Features
The script places "Quick Add" (or "Update") buttons next to your items. Clicking these will fetch the current market value and auto-fill the price and quantity fields.
 * Smart Automation: A "Quick Fill" button allows you to price or update every item in your current tab at once.
 * Reversible Actions: Made a mistake? Individual item buttons now allow you to Undo a fill with a single click.
 * Flexible Protection: Includes optional NPC price floor protection to prevent accidental under-pricing, which can now be toggled off in settings.
 * Efficiency: A smart caching system stores price data for 5 minutes to minimize API calls and speed up usage.
 * Compatibility: Fully optimized for desktop and the Torn PDA mobile interface, with automatic dark and light mode detection.

## How to Use

 * Installation: Install the script and enter your Torn Public API key when prompted on the first run.

 * Adding Items: Navigate to the "Add Items" page in your Bazaar.

   * Single Item: Click the grey button next to an item to fetch its price. The button will turn Red. Click it again to Undo/Clear that item.

   * Bulk: Use the "Quick Fill" button at the top to price all items in the current category tab.

 * Managing Inventory: Navigate to the "Manage Bazaar" page. You can use the same features to update the prices of currently listed items to ensure they remain competitive.

 * Customization: Click the "Settings" button to:

   * Adjust your Discount Percentage (positive to undercut, negative to overprice).
   * Toggle the NPC Safety Limit.
   * Clear your price cache or update your API key.
Requirements

 * A Torn Public API key (generated in your Torn preferences under the API tab).
 * Tampermonkey or a compatible userscript manager (works natively with Torn PDA on Android).
