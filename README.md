# Torn Bazaar Quick Pricer

**Author:** Zedtrooper [3028329]  
**Current Version:** 2.1

A Tampermonkey userscript for the text-based RPG [Torn](https://www.torn.com) that streamlines the process of adding items to your **Bazaar**. It automatically fetches current market values via the Torn API and prices your items competitively with a single click.

---

## 🚀 Features

* **One-Click Pricing:** Adds a "**💰 Add**" button to every item in your Bazaar "Manage" page.
* **Live Market Data:** Fetches the real-time **market value** for items using the official Torn API.
* **Smart Auto-Fill:** Automatically fills both the price and the maximum available quantity for the item.
* **Customizable Discounts:** Set a default percentage to **undercut the market average** (e.g., list at 1% below market value).
* **Safety Guards:** Includes a "**Price Floor Warning**" to alert you if an item is being listed dangerously low compared to market value.
* **API Caching:** Caches price data for 5 minutes to minimize API calls and speed up usage.

---

## 🛠️ Installation

1.  **Install a Userscript Manager:**
    * [Tampermonkey](https://www.tampermonkey.net/) (Recommended for Chrome/Edge/Firefox)
    * [Violentmonkey](https://violentmonkey.top/)
    * Also supports Torn PDA android app
2.  **Install the Script:**
    * Head over to (https://greasyfork.org/en/scripts/558562-torn-bazaar-quick-pricer) tap the green install button on the website to install the script.
3.  **Reload Torn:**
    * Refresh your Torn Bazaar page to initialize the script.

---

## ⚙️ Configuration

### API Key Setup
Upon first use, the script will prompt you for your **Public API Key**.

1.  **Get your Key:** Go to [Torn Settings → API Key](https://www.torn.com/preferences.php#tab=api).
2.  **Create Key:** Generate a **Public** key.
3.  **Enter Key:** Paste it into the prompt when the script loads.

### Changing Settings
You can adjust your pricing strategy at any time:
* Look for the **⚙️ (Gear Icon)** located next to your Bazaar title.
* **Discount Percentage:** Set how much to undercut the market (default is **1%**).
* **Price Floor:** Set a warning threshold percentage.
* **Clear Cache:** Force the script to re-fetch fresh prices.

---

## 📖 How to Use

1.  Navigate to your **Bazaar** in Torn.
2.  Click on **"Manage Items"**.
3.  You will see a green **💰 Add** button appear next to each item.
4.  Click the button:
    * The script fetches the current market value.
    * It calculates your price (Market Value - Discount).
    * It fills the price input and maxes out the quantity.
5.  The price box will flash green to confirm the value has been set.

---

## ⚠️ Disclaimer

* **Use at your own risk.** While this script uses public API data and does not automate actions, always adhere to Torn's scripting rules.
* This script is not affiliated with or endorsed by Torn.

---
*Created by Zedtrooper [3028329]*
