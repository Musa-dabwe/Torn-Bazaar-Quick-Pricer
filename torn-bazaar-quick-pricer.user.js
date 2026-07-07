// ==UserScript==
// @name         Torn Bazaar Quick Pricer
// @namespace    http://tampermonkey.net/
// @version      2.9
// @description  Auto-fill bazaar items with market-based pricing (PDA optimized)
// @author       Zedtrooper [3028329]
// @license      MIT
// @match        https://www.torn.com/bazaar.php*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @run-at       document-end
// @noframes
// @homepage     https://github.com/Musa-dabwe/Torn-Bazaar-Quick-Pricer
// @supportURL   https://github.com/Musa-dabwe/Torn-Bazaar-Quick-Pricer/issues
// @downloadURL https://update.greasyfork.org/scripts/558562/Torn%20Bazaar%20Quick%20Pricer.user.js
// @updateURL https://update.greasyfork.org/scripts/558562/Torn%20Bazaar%20Quick%20Pricer.meta.js
// ==/UserScript==

(function() {
    'use strict';

    if (typeof GM_getValue === 'undefined') {
        console.error('[BazaarQuickPricer] GM_getValue not available! Please check Tampermonkey settings.');
        return;
    }

    const VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '2.9';

    console.log(`[BazaarQuickPricer] v${VERSION} Starting (PDA optimized)...`);

    // =====================================================================
    // CONFIGURATION
    // =====================================================================

    /** Torn API keys are exactly 16 alphanumeric characters. */
    function isValidApiKey(k) {
        return typeof k === 'string' && /^[a-zA-Z0-9]{16}$/.test(k);
    }

    /** Discounts outside 0–99.9% would produce negative or absurd prices. */
    function clampDiscount(val) {
        const n = parseFloat(val);
        if (!Number.isFinite(n)) return 0;
        return Math.min(Math.max(n, 0), 99.9);
    }

    /** Price-change alert threshold: 0 confirms every change, capped at 1000%. */
    function clampThreshold(val) {
        const n = parseFloat(val);
        if (!Number.isFinite(n)) return 20;
        return Math.min(Math.max(n, 0), 1000);
    }

    // In-memory settings cache: storage is hit once per key, then reads stay in
    // memory (hot paths read settings once per item) and writes go through to
    // GM_setValue immediately.
    const settingsCache = {};
    function getSetting(name, def) {
        if (!(name in settingsCache)) settingsCache[name] = GM_getValue(name, def);
        return settingsCache[name];
    }
    function setSetting(name, val) {
        settingsCache[name] = val;
        GM_setValue(name, val);
    }

    // Torn PDA key injection — runs once at startup, before any settings read.
    // NOTE: this literal is the ONLY occurrence of the PDA placeholder in the whole
    // file. Torn PDA's script manager does a global find/replace of every occurrence
    // of the placeholder token in the source with the real key before running it — so
    // if the token appears anywhere else (even in a comment or a comparison), that
    // text gets rewritten too and silently breaks. Validate by format instead, never
    // by string equality against the token itself.
    (function persistInjectedPdaKey() {
        const injected = '###PDA-APIKEY###';
        if (isValidApiKey(injected) && injected !== GM_getValue('tornApiKey', '')) {
            GM_setValue('tornApiKey', injected); // persist so it survives even without re-injection
        }
    })();

    const CONFIG = {
        get defaultDiscount() { return getSetting('discountPercent', 0); },
        set defaultDiscount(val) { setSetting('discountPercent', val); },
        get apiKey() {
            const k = getSetting('tornApiKey', '');
            return isValidApiKey(k) ? k : '';
        },
        set apiKey(val) { setSetting('tornApiKey', val); },
        get disableNpcCheck() { return getSetting('disableNpcCheck', false); },
        set disableNpcCheck(val) { setSetting('disableNpcCheck', val); },
        get skipRwWeapons() { return getSetting('skipRwWeapons', true); },
        set skipRwWeapons(val) { setSetting('skipRwWeapons', val); },
        // $1 is Torn's convention for intentional giveaway/transfer listings —
        // batch runs must not "correct" them to market value.
        get skipDollarItems() { return getSetting('skipDollarItems', true); },
        set skipDollarItems(val) { setSetting('skipDollarItems', val); },
        get priceDiffThreshold() { return clampThreshold(getSetting('priceDiffThreshold', 20)); },
        set priceDiffThreshold(val) { setSetting('priceDiffThreshold', clampThreshold(val)); },
        get cacheTimeoutMin() { return getSetting('cacheTimeoutMin', 5); },
        set cacheTimeoutMin(val) { setSetting('cacheTimeoutMin', val); },
        get cacheTimeout() { return Math.max(1, this.cacheTimeoutMin) * 60 * 1000; }
    };

    // =====================================================================
    // PRICE CACHE  (in-memory copy of the persisted cache; stale entries are
    // pruned at startup and writes are debounced into a single GM_setValue so
    // batch runs don't re-serialize the whole object once per item)
    // =====================================================================

    let priceCache = GM_getValue('priceCache', {});
    let priceCachePersistTimer = null;

    (function pruneStalePrices() {
        const now = Date.now();
        let dirty = false;
        for (const id of Object.keys(priceCache)) {
            const entry = priceCache[id];
            if (!entry || !entry.timestamp || now - entry.timestamp >= CONFIG.cacheTimeout) {
                delete priceCache[id];
                dirty = true;
            }
        }
        if (dirty) GM_setValue('priceCache', priceCache);
    })();

    function cachePrice(itemId, marketValue, sellPrice) {
        priceCache[itemId] = { marketValue, sellPrice, timestamp: Date.now() };
        clearTimeout(priceCachePersistTimer);
        priceCachePersistTimer = setTimeout(() => GM_setValue('priceCache', priceCache), 500);
    }

    function getCachedPrice(itemId) {
        const entry = priceCache[itemId];
        if (entry && entry.timestamp && Date.now() - entry.timestamp < CONFIG.cacheTimeout) return entry;
        return null;
    }

    function clearPriceCache() {
        priceCache = {};
        clearTimeout(priceCachePersistTimer);
        GM_setValue('priceCache', priceCache);
    }

    // =====================================================================
    // DEBUG LOGGING  (set the "debug" flag in script storage to enable)
    // =====================================================================

    const DEBUG = getSetting('debug', false);
    function log(...args) {
        if (DEBUG) console.log('[BazaarQuickPricer]', ...args);
    }

    // =====================================================================
    // TORN DOM SELECTORS  (single source of truth: Torn's CSS-module class
    // hashes change on front-end rebuilds, so every fragile selector lives
    // here and a breakage is a one-spot fix)
    // =====================================================================

    const SELECTORS = {
        bazaarRoot: '#bazaarRoot',
        bazaarRootLegacy: '.bazaar-main-wrap',
        // Add-items page
        itemLists: 'ul.items-cont, div[class*="itemsContainner___"], div[class*="rowItems___"]',
        addItems: 'li.clearfix:not(.disabled), div[class*="item___GYCYJ"], div[class*="item___khvF6"]',
        allAddItems: 'ul.items-cont li.clearfix:not(.disabled), div[class*="itemsContainner___"] div[class*="item___"], div[class*="rowItems___"] div[class*="item___"]',
        tabItemClass: 'item___UN3Mg', // tab entries share the item___ prefix; excluded everywhere
        itemTitle: 'div[class*="name___"], div.title-wrap',
        itemDescription: 'div[class*="description___"], div.title-wrap',
        itemImage: 'div.image-wrap img',
        amountWrap: 'div[class*="amount___"], div.amount-main-wrap',
        priceWrap: 'div[class*="price___"], div.price',
        priceInputs: 'div.price div input',
        quantityCheckbox: 'div.choice-container, [class*="choiceContainer___"]',
        // Manage page
        manageItems: 'div[class*="item___"]',
        managePriceWrap: 'div[class*="price"]',
        managePriceInput: 'input.input-money, input',
        sectionHeadings: 'div[role="heading"], div[class*="title"], div[class*="panelHeader"], div[class*="titleContainer"]',
        // RW detection
        rwBonusIcons: 'ul.bonuses-wrap li.bonus i[class^="bonus-attachment-"]',
        rarityGlow: 'div.title-wrap div.image-wrap[class*="glow-"]'
    };

    const warnedSelectors = new Set();
    /** Warn once per selector when an expected element is missing (Torn markup change). */
    function warnSelectorMiss(name) {
        if (warnedSelectors.has(name)) return;
        warnedSelectors.add(name);
        console.warn(`[BazaarQuickPricer] Selector "${name}" matched nothing — Torn's markup may have changed`);
    }

    // =====================================================================
    // RW WEAPON DETECTION
    // =====================================================================

    const RW_BONUS_NAMES = new Set([
        'achilles', 'assassinate', 'backstab', 'berserk', 'bleed', 'blindside',
        'bloodlust', 'comeback', 'conserve', 'cripple', 'crusher', 'cupid',
        'deadeye', 'deadly', 'disarm', 'double-edged', 'double tap', 'empower',
        'eviscerate', 'execute', 'expose', 'finale', 'focus', 'frenzy', 'fury',
        'grace', 'home run', 'irradiate', 'motivation', 'paralyze', 'parry',
        'penetrate', 'plunder', 'powerful', 'proficience', 'puncture', 'quicken',
        'rage', 'revitalize', 'roshambo', 'slow', 'smurf', 'specialist',
        'stricken', 'stun', 'suppress', 'sure shot', 'throttle', 'warlord',
        'weaken', 'wind-up', 'wither',
        'blindfire', 'burn', 'demoralize', 'emasculate', 'freeze', 'hazardous',
        'lacerate', 'laceration', 'poison', 'poisoned', 'shock', 'sleep',
        'smash', 'spray', 'storage', 'toxin'
    ]);

    /**
     * Detect whether an item row is a ranked-war weapon.
     * Torn renders RW bonuses as <i class="bonus-attachment-{name}"> inside
     * <li class="bonus left"> inside <ul class="bonuses-wrap">.
     * @returns {{isRanked: boolean, bonus: ?string, rarity: ?string}}
     */
    function getRWBonusInfo(itemElement) {
        const bonusIcons = itemElement.querySelectorAll(SELECTORS.rwBonusIcons);
        for (const icon of bonusIcons) {
            const cls = icon.className || '';
            if (cls.includes('blank-bonus')) continue;
            const match = cls.match(/bonus-attachment-([a-z0-9-]+)/i);
            if (!match) continue;
            const bonusName = match[1].toLowerCase();
            if (RW_BONUS_NAMES.has(bonusName)) {
                const rarity = detectRarity(itemElement);
                log(`RW detected: ${bonusName} (${rarity || 'unknown'})`);
                return { isRanked: true, bonus: bonusName, rarity };
            }
        }
        return { isRanked: false, bonus: null, rarity: null };
    }

    /** Rarity is encoded as glow-yellow / glow-orange / glow-red on the image wrap. */
    function detectRarity(itemElement) {
        const glowEl = itemElement.querySelector(SELECTORS.rarityGlow);
        if (!glowEl) return null;
        const cls = glowEl.className;
        if (cls.includes('glow-yellow')) return 'yellow';
        if (cls.includes('glow-orange')) return 'orange';
        if (cls.includes('glow-red'))    return 'red';
        return null;
    }

    function rwSkipLabel(info) {
        const rarity = info.rarity ? info.rarity.charAt(0).toUpperCase() + info.rarity.slice(1) : 'Unknown rarity';
        const bonus = info.bonus ? info.bonus.charAt(0).toUpperCase() + info.bonus.slice(1) : 'Unknown bonus';
        return `${rarity} ${bonus} RW weapon`;
    }

    /** Shared "price an RW weapon anyway?" dialog. @returns {Promise<boolean>} */
    function confirmRwPricing(rwInfo) {
        return qpConfirm(
            `This appears to be a ${rwSkipLabel(rwInfo)}.\nRW weapons have unique pricing not based on standard market value.\n\nPrice it anyway using the base item's market value?`,
            { title: 'RW WEAPON DETECTED', confirmText: 'PRICE IT' }
        );
    }

    // =====================================================================
    // STATE
    // =====================================================================

    const processedItems = new WeakSet();
    const processedManageItems = new WeakSet();
    let mutationDebounceTimer = null;

    // =====================================================================
    // GLOBAL CSS  (button system + badges)
    // =====================================================================

    // Best-effort cleanup of a previous instance (PDA re-injection / SPA nav
    // without a full reload): sweep any UI the old instance left in the DOM.
    ['#qp-style', '.qp-chip', '.qp-toast-wrap', '.qp-overlay'].forEach(sel =>
        document.querySelectorAll(sel).forEach(el => el.remove()));

    const style = document.createElement('style');
    style.id = 'qp-style';
    style.textContent = `
        .qp-btn {
            background: #5F5F5F !important;
            color: white !important;
            border: none;
            border-radius: 0 !important;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: filter 0.2s;
            padding: 5px;
            font-size: 13px;
            font-weight: 700;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
        }
        .qp-btn:hover { filter: brightness(0.8); }
        .qp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .qp-btn-red { background: #E3392C !important; color: white !important; }
        .qp-btn-update { padding: 5px; }

        .quick-price-btn, .quick-update-price-btn {
            display: flex; align-items: center; flex-shrink: 0;
            margin-left: auto; padding-right: 5px; z-index: 10;
        }

        .qp-rw-dot {
            width: 7px; height: 7px;
            border-radius: 0 !important;
            flex-shrink: 0;
            margin-right: 4px;
            animation: qpDotBlink 1.2s ease-in-out infinite;
            pointer-events: none;
        }
        .qp-rw-dot.rw-yellow { background: #E8C97E; }
        .qp-rw-dot.rw-orange { background: #d4620a; }
        .qp-rw-dot.rw-red    { background: #c0392b; }
        .qp-rw-dot.rw-unknown { background: #7B2FBE; }
        @keyframes qpDotBlink {
            0%, 100% { opacity: 1; }
            50%       { opacity: 0.2; }
        }

        /* ── TERMINAL MONO SETTINGS UI (light only) ── */
        .qp-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.85);
            z-index: 99999;
            display: flex; align-items: center; justify-content: center;
            font-family: ui-monospace, 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
            padding: 20px 15px;
            box-sizing: border-box;
        }
        .qp-modal {
            --bg: #f4f4f0;
            --header-bg: #14140f;
            --header-text: #c8f5cf;
            --text: #1a1a1a;
            --muted: #5a5a5a;
            --accent: #0a7a3d;
            --border: #c8c8c0;
            --field: #ffffff;
            --danger: #b3271e;
            width: 100%; max-width: 420px;
            background: var(--bg);
            color: var(--text);
            border: 1px solid var(--border);
            display: flex; flex-direction: column;
            border-radius: 0 !important;
            max-height: 100%;
            overflow-y: auto;
        }
        @media (min-width: 900px) {
            .qp-modal { width: 720px; max-width: 720px; }
        }
        .qp-header {
            background: var(--header-bg);
            padding: 16px 15px;
            position: relative;
            display: flex; flex-direction: column; gap: 10px;
        }
        .qp-header h1 {
            margin: 0;
            color: var(--header-text);
            font-size: 20px;
            font-weight: 700;
            line-height: 1.3;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .qp-header h1:before { content: "$ "; opacity: 0.6; }
        .qp-header h1 .qp-cursor {
            display: inline-block;
            width: 8px; height: 15px;
            margin-left: 3px;
            background: var(--header-text);
            vertical-align: -2px;
            animation: qpDotBlink 1.2s ease-in-out infinite;
        }
        .qp-header p {
            margin: 4px 0 0 0;
            color: var(--header-text);
            opacity: 0.55;
            font-size: 9px;
            font-weight: 400;
            text-transform: uppercase;
            letter-spacing: 2px;
        }
        .qp-gold-rule {
            height: 1px;
            background: linear-gradient(90deg, var(--accent), transparent);
        }
        .qp-body {
            padding: 16px 15px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .qp-card {
            background: var(--field);
            border: 1px solid var(--border);
            padding: 10px 12px;
            display: grid;
            grid-template-columns: 96px 1fr;
            align-items: center;
        }
        .qp-card label {
            color: var(--accent);
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
        }
        .qp-card label:before { content: "["; opacity: 0.6; }
        .qp-card label:after { content: "]"; opacity: 0.6; }
        .qp-card input {
            background: transparent;
            border: none;
            color: var(--text);
            font-size: 14px;
            font-weight: 500;
            font-family: inherit;
            outline: none;
            width: 100%;
        }
        .qp-card:focus-within { border-color: var(--accent); }
        .qp-input-wrap {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .qp-eye-toggle {
            cursor: pointer;
            color: var(--muted);
            display: flex;
            align-items: center;
        }
        .qp-eye-toggle:hover { color: var(--text); }

        .qp-toggles-card {
            background: var(--field);
            border: 1px solid var(--border);
            padding: 4px 12px;
            display: flex;
            flex-direction: column;
        }
        .qp-toggle-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
        }
        .qp-toggle-row:not(:last-child) { border-bottom: 1px solid var(--border); }
        .qp-toggle-row span {
            color: var(--text);
            font-size: 11px;
            font-weight: 500;
            text-transform: uppercase;
        }
        .qp-toggle-row span.qp-on { color: var(--accent); }

        .qp-toggle {
            position: relative;
            display: inline-block;
            width: 30px;
            height: 15px;
        }
        .qp-toggle input { opacity: 0; width: 0; height: 0; }
        .qp-toggle-track {
            position: absolute;
            cursor: pointer;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: var(--field);
            border: 1px solid var(--border);
            border-radius: 0 !important;
            transition: .2s;
        }
        .qp-toggle-track:before {
            position: absolute;
            content: "";
            height: 9px;
            width: 9px;
            left: 2px;
            bottom: 2px;
            background-color: var(--muted);
            transition: .2s;
        }
        input:checked + .qp-toggle-track {
            border-color: var(--accent);
        }
        input:checked + .qp-toggle-track:before {
            transform: translateX(14px);
            background-color: var(--accent);
        }

        .qp-footer {
            padding: 0 15px 16px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        .qp-buttons {
            display: flex;
            gap: 8px;
        }
        .qp-buttons button {
            flex: 1;
            padding: 10px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            cursor: pointer;
            background: transparent;
            border: 1px solid var(--border);
            color: var(--text);
            font-family: inherit;
            border-radius: 0 !important;
        }
        .qp-buttons button:hover { border-color: var(--accent); }
        .qp-btn-clear {
            border-color: var(--danger) !important;
            color: var(--danger) !important;
        }
        .qp-btn-auth {
            background: transparent !important;
            border-color: var(--accent) !important;
            color: var(--accent) !important;
            font-weight: 700;
        }
        .qp-btn-abort {
            border-color: var(--border) !important;
            color: var(--muted) !important;
        }
        .qp-footer-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 10px;
            color: var(--muted);
        }
        .qp-github {
            color: var(--accent);
            text-decoration: none;
        }

        /* ── FLOATING DRAG CHIP (replaces embedded top-bar buttons) ── */
        .qp-chip {
            position: fixed;
            left: 50%; bottom: 18px;
            transform: translateX(-50%);
            display: flex; align-items: center; gap: 4px;
            background: #3d3d3d;
            border: 1px solid #545454;
            border-radius: 0 !important;
            padding: 5px;
            z-index: 99998;
            box-shadow: 0 6px 18px rgba(0,0,0,0.45);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
            touch-action: none;
        }
        .qp-chip.qp-chip-dragging { opacity: 0.85; box-shadow: 0 10px 26px rgba(0,0,0,0.6); }
        .qp-chip-grip {
            width: 14px; height: 24px;
            display: flex; align-items: center; justify-content: center;
            color: #8a8a8a; font-size: 12px; letter-spacing: -1px;
            cursor: grab; flex-shrink: 0; user-select: none;
        }
        .qp-chip-grip:active { cursor: grabbing; }
        .qp-chip-fill {
            background: #E8C97E !important; color: #1a1a1a !important;
            font-weight: 700; font-size: 12px; text-transform: uppercase;
            padding: 8px 14px !important; white-space: nowrap;
        }
        .qp-chip-divider { width: 1px; height: 20px; background: #545454; flex-shrink: 0; }
        .qp-chip-gear {
            width: 34px; height: 34px; padding: 0 !important;
            display: flex; align-items: center; justify-content: center;
        }

        /* ── TOASTS + CONFIRM DIALOG ── */
        .qp-toast-wrap {
            position: fixed;
            bottom: 70px; left: 50%;
            transform: translateX(-50%);
            z-index: 100000;
            display: flex; flex-direction: column; gap: 6px; align-items: center;
            pointer-events: none;
        }
        .qp-toast {
            background: #14140f;
            color: #c8f5cf;
            border: 1px solid #545454;
            padding: 8px 14px;
            font-size: 12px;
            font-family: ui-monospace, 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
            max-width: 90vw;
            box-shadow: 0 6px 18px rgba(0,0,0,0.45);
        }
        .qp-toast-error { color: #ffb3ad; border-color: #b3271e; }
        .qp-toast-success { border-color: #0a7a3d; }
        .qp-confirm-text {
            margin: 0;
            font-size: 12px;
            line-height: 1.6;
            white-space: pre-line;
            color: var(--text);
        }
        .qp-note {
            margin: 0;
            font-size: 10px;
            line-height: 1.5;
            color: var(--muted);
        }
    `;
    document.head.appendChild(style);

    // =====================================================================
    // SVGs
    // =====================================================================

    const addButtonSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3,7.5v11c0,1.38,1.12,2.5,2.5,2.5h1c.83,0,1.5,.67,1.5,1.5s-.67,1.5-1.5,1.5h-1c-3.03,0-5.5-2.47-5.5-5.5V7.5C0,4.47,2.47,2,5.5,2h.35c.56-1.18,1.76-2,3.15-2h2c1.39,0,2.59,.82,3.15,2h.35c1.96,0,3.78,1.05,4.76,2.75,.42,.72,.17,1.63-.55,2.05-.24,.14-.49,.2-.75,.2-.52,0-1.02-.27-1.3-.75-.45-.77-1.28-1.25-2.17-1.25h-.35c-.56,1.18-1.76,2-3.15,2h-2c-1.39,0-2.59-.82-3.15-2h-.35c-1.38,0-2.5,1.12-2.5,2.5Zm14.5,6.5h-1c-.83,0-1.5,.67-1.5,1.5s.67,1.5,1.5,1.5h1c.83,0,1.5-.67,1.5-1.5s-.67-1.5-1.5-1.5Zm6.5-.5v6c0,2.48-2.02,4.5-4.5,4.5h-5c-2.48,0-4.5-2.02-4.5-4.5v-6c0-2.48,2.02-4.5,4.5-4.5h5c2.48,0,4.5,2.02,4.5,4.5Zm-3,0c0-.83-.67-1.5-1.5-1.5h-5c-.83,0-1.5,.67-1.5,1.5v6c0,.83,.67,1.5,1.5,1.5h5c.83,0,1.5-.67,1.5-1.5v-6Z"/></svg>`;
    const refreshSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12,2C6.48,2,2,6.48,2,12s4.48,10,10,10,10-4.48,10-10S17.52,2,12,2Zm0,18c-4.41,0-8-3.59-8-8s3.59-8,8-8,8,3.59,8,8-3.59,8-8,8Zm-1-13h2v6h-2v-6Zm0,8h2v2h-2v-2Z"/><path d="M13,7v6h4l-5,5-5-5h4V7h2Z" transform="translate(0,-1)"/></svg>`;

    const eyeSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`;
    const eyeOffSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>`;

    const gearSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M19.14,12.94c.04-.3,.06-.61,.06-.94s-.02-.64-.06-.94l2.03-1.58c.18-.14,.23-.41,.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39,.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24,0-.43,.17-.47,.41l-.36,2.54c-.59,.24-1.13,.57-1.62,.94l-2.39-.96c-.22-.08-.47,0-.59,.22l-1.92,3.32c-.12,.21-.08,.47,.12,.61l2.03,1.58c-.04,.3-.06,.62-.06,.94s.02,.64,.06,.94l-2.03,1.58c-.18,.14-.23,.41-.12,.61l1.92,3.32c.12,.22,.37,.29,.59,.22l2.39-.96c.5,.38,1.03,.7,1.62,.94l.36,2.54c.05,.24,.24,.41,.48,.41h3.84c.24,0,.44-.17,.47-.41l.36-2.54c.59-.24,1.13-.56,1.62-.94l2.39,.96c.22,.08,.47,0,.59-.22l1.92-3.32c.12-.22,.07-.47-.12-.61l-2.02-1.58Zm-7.14,2.44c-1.86,0-3.38-1.52-3.38-3.38s1.52-3.38,3.38-3.38,3.38,1.52,3.38,3.38-1.52,3.38-3.38,3.38Z"/></svg>`;

    // =====================================================================
    // UI HELPERS
    // =====================================================================

    function wireToggleRowLabel(overlay, checkboxId) {
        const checkbox = overlay.querySelector('#' + checkboxId);
        const label = checkbox.closest('.qp-toggle-row').querySelector('span');
        const sync = () => label.classList.toggle('qp-on', checkbox.checked);
        sync();
        checkbox.addEventListener('change', sync);
    }

    /** Show/hide toggle for the API key input (click or Enter/Space). */
    function wireEyeToggle(overlay, apiInput) {
        const eyeToggle = overlay.querySelector('#qpEyeToggle');
        const flip = () => {
            const isPass = apiInput.type === 'password';
            apiInput.type = isPass ? 'text' : 'password';
            eyeToggle.innerHTML = isPass ? eyeOffSVG : eyeSVG;
        };
        eyeToggle.addEventListener('click', flip);
        eyeToggle.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
        });
    }

    /** Dialog accessibility: role/aria attributes, Escape to close, Tab focus trap. */
    function wireOverlayA11y(overlay, onClose) {
        const modal = overlay.querySelector('.qp-modal');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
            if (e.key !== 'Tab') return;
            const focusables = overlay.querySelectorAll('button, input, a[href], [tabindex]:not([tabindex="-1"])');
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        });
    }

    let toastWrap = null;

    /** Non-blocking notification. @param {'info'|'success'|'error'} kind */
    function qpToast(message, kind = 'info', duration = 4000) {
        if (!toastWrap || !document.body.contains(toastWrap)) {
            toastWrap = document.createElement('div');
            toastWrap.className = 'qp-toast-wrap';
            document.body.appendChild(toastWrap);
        }
        const toast = document.createElement('div');
        toast.className = `qp-toast qp-toast-${kind}`;
        toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        toast.textContent = message;
        toastWrap.appendChild(toast);
        setTimeout(() => toast.remove(), duration);
    }

    /**
     * Non-blocking replacement for window.confirm, styled like the settings modal.
     * @returns {Promise<boolean>} true if the user confirmed
     */
    function qpConfirm(message, opts = {}) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'qp-overlay';
            overlay.innerHTML = `
                <div class="qp-modal">
                    <header class="qp-header">
                        <h1>${opts.title || 'CONFIRM'}<span class="qp-cursor"></span></h1>
                        <div class="qp-gold-rule"></div>
                    </header>
                    <div class="qp-body"><p class="qp-confirm-text"></p></div>
                    <div class="qp-footer">
                        <div class="qp-buttons">
                            <button class="qp-btn-auth" data-qp="ok">${opts.confirmText || 'CONFIRM'}</button>
                            <button class="qp-btn-abort" data-qp="cancel">CANCEL</button>
                        </div>
                    </div>
                </div>
            `;
            overlay.querySelector('.qp-confirm-text').textContent = message;
            document.body.appendChild(overlay);
            const done = (val) => { overlay.remove(); resolve(val); };
            overlay.querySelector('[data-qp="ok"]').onclick = () => done(true);
            overlay.querySelector('[data-qp="cancel"]').onclick = () => done(false);
            overlay.onclick = (e) => { if (e.target === overlay) done(false); };
            wireOverlayA11y(overlay, () => done(false));
            overlay.querySelector('[data-qp="ok"]').focus();
        });
    }

    // =====================================================================
    // UI — API KEY PROMPT
    // =====================================================================

    function showApiKeyPrompt() {
        const overlay = document.createElement('div');
        overlay.className = 'qp-overlay';
        overlay.innerHTML = `
            <div class="qp-modal">
                <header class="qp-header">
                    <h1><span>QUICK</span><span>PRICER</span><span class="qp-cursor"></span></h1>
                    <p>API AUTHORIZATION REQUIRED</p>
                    <div class="qp-gold-rule"></div>
                </header>
                <div class="qp-body">
                    <div class="qp-card">
                        <label>API KEY</label>
                        <div class="qp-input-wrap">
                            <input type="password" id="qpApiKey" placeholder="ENTER KEY" aria-label="Torn API key" />
                            <div class="qp-eye-toggle" id="qpEyeToggle" role="button" tabindex="0" aria-label="Show or hide API key">${eyeSVG}</div>
                        </div>
                    </div>
                    <p class="qp-note">A <strong>Public</strong>-level key is all this script needs — it only reads
                    item market data. Create one at Torn &gt; Settings &gt; API Keys &gt; Create Key &gt; Public.
                    Don't paste a Full Access key into third-party scripts.</p>
                </div>
                <div class="qp-footer">
                    <div class="qp-buttons">
                        <button class="qp-btn-auth" id="qpSave">AUTHORIZE</button>
                        <button class="qp-btn-abort" id="qpCancel">CLOSE</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const apiInput = overlay.querySelector('#qpApiKey');
        wireEyeToggle(overlay, apiInput);

        overlay.querySelector('#qpSave').onclick = () => {
            const key = apiInput.value.trim();
            if (isValidApiKey(key)) {
                CONFIG.apiKey = key;
                overlay.remove();
                // No reload needed: the chip, observer, and item buttons are already
                // wired up; the queue simply starts working once a key exists.
                qpToast('API key saved', 'success');
            } else {
                qpToast('Please enter a valid 16-character alphanumeric API key', 'error');
            }
        };
        overlay.querySelector('#qpCancel').onclick = () => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        wireOverlayA11y(overlay, () => overlay.remove());
        apiInput.focus();
    }

    function showSettingsPanel() {
        const overlay = document.createElement('div');
        overlay.className = 'qp-overlay';
        overlay.innerHTML = `
            <div class="qp-modal">
                <header class="qp-header">
                    <h1><span>QUICK</span><span>PRICER</span><span class="qp-cursor"></span></h1>
                    <p>BAZAAR MANAGEMENT SUITE</p>
                    <div class="qp-gold-rule"></div>
                </header>
                <div class="qp-body">
                    <div class="qp-card">
                        <label>API KEY</label>
                        <div class="qp-input-wrap">
                            <input type="password" id="qpApiKey" aria-label="Torn API key" />
                            <div class="qp-eye-toggle" id="qpEyeToggle" role="button" tabindex="0" aria-label="Show or hide API key">${eyeSVG}</div>
                        </div>
                    </div>
                    <p class="qp-note">A <strong>Public</strong>-level key is enough — the script only reads item market data.</p>
                    <div class="qp-card">
                        <label>DISCOUNT %</label>
                        <input type="number" id="qpDiscount" value="${CONFIG.defaultDiscount}" step="0.1" min="0" max="99.9" aria-label="Discount percent" />
                    </div>
                    <div class="qp-card">
                        <label>ALERT AT %</label>
                        <input type="number" id="qpThreshold" value="${CONFIG.priceDiffThreshold}" step="1" min="0" max="1000" aria-label="Ask before applying price changes larger than this percent" />
                    </div>
                    <div class="qp-card">
                        <label>CACHE (MIN)</label>
                        <input type="number" id="qpCacheMin" value="${CONFIG.cacheTimeoutMin}" step="1" min="1" max="120" aria-label="Price cache lifetime in minutes" />
                    </div>
                    <div class="qp-toggles-card">
                        <div class="qp-toggle-row">
                            <span>NPC Floor Enforcement</span>
                            <label class="qp-toggle">
                                <input type="checkbox" id="qpNpcCheck" ${!CONFIG.disableNpcCheck ? 'checked' : ''} />
                                <span class="qp-toggle-track"></span>
                            </label>
                        </div>
                        <div class="qp-toggle-row">
                            <span>Skip RW Weapons</span>
                            <label class="qp-toggle">
                                <input type="checkbox" id="qpRwCheck" ${CONFIG.skipRwWeapons ? 'checked' : ''} />
                                <span class="qp-toggle-track"></span>
                            </label>
                        </div>
                        <div class="qp-toggle-row">
                            <span>Skip $1 Items (Update All)</span>
                            <label class="qp-toggle">
                                <input type="checkbox" id="qpDollarCheck" ${CONFIG.skipDollarItems ? 'checked' : ''} />
                                <span class="qp-toggle-track"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="qp-footer">
                    <div class="qp-buttons">
                        <button class="qp-btn-clear" id="qpClearCache">CLEAR CACHE</button>
                        <button class="qp-btn-auth" id="qpSave">AUTHORIZE</button>
                        <button class="qp-btn-abort" id="qpCancel">CLOSE</button>
                    </div>
                    <div class="qp-footer-meta">
                        <span>v${VERSION}</span>
                        <a href="https://github.com/Musa-dabwe/Torn-Bazaar-Quick-Pricer" target="_blank" class="qp-github">GitHub</a>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        wireToggleRowLabel(overlay, 'qpNpcCheck');
        wireToggleRowLabel(overlay, 'qpRwCheck');
        wireToggleRowLabel(overlay, 'qpDollarCheck');

        const apiInput = overlay.querySelector('#qpApiKey');
        // Set via DOM, never string-interpolated into HTML: a malformed stored value
        // containing quotes must not be able to break out of the attribute.
        apiInput.value = CONFIG.apiKey;
        wireEyeToggle(overlay, apiInput);

        overlay.querySelector('#qpClearCache').onclick = () => {
            clearPriceCache();
            const btn = overlay.querySelector('#qpClearCache');
            btn.textContent = 'CLEARED';
            setTimeout(() => { btn.textContent = 'CLEAR CACHE'; }, 1500);
        };

        overlay.querySelector('#qpSave').onclick = () => {
            const key = apiInput.value.trim();
            if (key !== '' && !isValidApiKey(key)) {
                qpToast('API key must be 16 alphanumeric characters (leave empty to clear it)', 'error');
                return;
            }
            CONFIG.defaultDiscount = clampDiscount(overlay.querySelector('#qpDiscount').value);
            CONFIG.priceDiffThreshold = clampThreshold(overlay.querySelector('#qpThreshold').value);
            CONFIG.apiKey = key;
            CONFIG.disableNpcCheck = !overlay.querySelector('#qpNpcCheck').checked;
            CONFIG.skipRwWeapons = overlay.querySelector('#qpRwCheck').checked;
            CONFIG.skipDollarItems = overlay.querySelector('#qpDollarCheck').checked;
            CONFIG.cacheTimeoutMin = Math.min(Math.max(parseInt(overlay.querySelector('#qpCacheMin').value, 10) || 5, 1), 120);
            overlay.remove();
            qpToast('Settings saved', 'success');
        };

        overlay.querySelector('#qpCancel').onclick = () => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        wireOverlayA11y(overlay, () => overlay.remove());
        apiInput.focus();
    }

    // =====================================================================
    // HELPERS
    // =====================================================================

    const itemIdCache = new Map();
    /** Torn item images live under /images/items/{itemId}/ — extract the id. */
    function getItemIdFromImage(image) {
        const src = image.src;
        if (itemIdCache.has(src)) return itemIdCache.get(src);
        const match = src.match(/\/(\d+)\//);
        if (match) {
            const itemId = parseInt(match[1], 10);
            itemIdCache.set(src, itemId);
            return itemId;
        }
        return null;
    }

    function getQuantity(itemElement) {
        const titleWrap = itemElement.querySelector(SELECTORS.itemTitle);
        if (!titleWrap) return 1;
        // Anchored to the end of the title so item names containing "x<digits>"
        // (e.g. weapon model numbers) can't be misread as a quantity.
        const match = titleWrap.textContent.trim().match(/\bx(\d+)\s*$/i);
        return match ? parseInt(match[1], 10) : 1;
    }

    /** Item name from a row's title, minus any trailing "x<qty>" marker. */
    function getItemName(itemElement) {
        const titleWrap = itemElement.querySelector(SELECTORS.itemTitle);
        if (!titleWrap) return null;
        return titleWrap.textContent.trim().replace(/\s*\bx\d+\s*$/i, '') || null;
    }

    // =====================================================================
    // API REQUEST QUEUE
    // =====================================================================

    const requestQueue = [];            // { itemId, retries } waiting to be fetched
    const pendingRequests = new Map();  // itemId -> callback[] (queued or in flight)
    let isProcessingQueue = false;
    let queueHalted = false;            // set when a fatal API error stops the run

    const REQUEST_SPACING_MS = 600;         // ≤100 req/min, Torn's documented limit
    const REQUEST_TIMEOUT_MS = 15000;
    const RATE_LIMIT_RETRY_DELAY_MS = 5000;
    const RATE_LIMIT_MAX_RETRIES = 2;

    // Torn API error codes that make every further request pointless this run.
    const FATAL_API_ERRORS = {
        2: 'Incorrect API key — please re-enter it in Settings.',
        8: 'Your IP is temporarily blocked by the Torn API.',
        9: 'The Torn API is currently disabled.'
    };

    function notifyApiError(message) {
        qpToast(message, 'error', 6000);
    }

    function finishRequest(itemId, result) {
        const callbacks = pendingRequests.get(itemId) || [];
        pendingRequests.delete(itemId);
        callbacks.forEach(cb => cb(result));
    }

    function failAllPending() {
        requestQueue.length = 0;
        const ids = Array.from(pendingRequests.keys());
        ids.forEach(id => finishRequest(id, { marketValue: 0, sellPrice: 0 }));
        isProcessingQueue = false;
    }

    function processRequestQueue() {
        if (isProcessingQueue || requestQueue.length === 0) return;
        if (queueHalted) { failAllPending(); return; }
        isProcessingQueue = true;
        const { itemId, retries } = requestQueue.shift();

        const releaseAndContinue = (delay) => {
            isProcessingQueue = false;
            setTimeout(processRequestQueue, delay);
        };
        const failItem = () => {
            finishRequest(itemId, { marketValue: 0, sellPrice: 0 });
            releaseAndContinue(REQUEST_SPACING_MS);
        };

        GM_xmlhttpRequest({
            method: 'GET',
            url: `https://api.torn.com/torn/${itemId}?selections=items&key=${CONFIG.apiKey}`,
            timeout: REQUEST_TIMEOUT_MS,
            onload: function(response) {
                try {
                    const data = JSON.parse(response.responseText);
                    if (data.error) {
                        const code = data.error.code;
                        if (FATAL_API_ERRORS[code]) {
                            if (code === 2) CONFIG.apiKey = '';
                            queueHalted = true;
                            notifyApiError(FATAL_API_ERRORS[code]);
                            finishRequest(itemId, { marketValue: 0, sellPrice: 0 });
                            failAllPending();
                            return;
                        }
                        if (code === 5 && retries < RATE_LIMIT_MAX_RETRIES) {
                            console.warn('[BazaarQuickPricer] Rate limited, backing off...');
                            requestQueue.unshift({ itemId, retries: retries + 1 });
                            releaseAndContinue(RATE_LIMIT_RETRY_DELAY_MS);
                            return;
                        }
                        console.warn(`[BazaarQuickPricer] API error ${code}: ${data.error.error}`);
                        failItem();
                    } else if (data.items?.[itemId]) {
                        const itemData = data.items[itemId];
                        const marketValue = itemData.market_value || 0;
                        const sellPrice = itemData.sell_price || 0;
                        cachePrice(itemId, marketValue, sellPrice);
                        finishRequest(itemId, { marketValue, sellPrice });
                        releaseAndContinue(REQUEST_SPACING_MS);
                    } else {
                        failItem();
                    }
                } catch (e) {
                    console.error('[BazaarQuickPricer] Parse error:', e);
                    failItem();
                }
            },
            onerror: failItem,
            ontimeout: function() {
                console.warn(`[BazaarQuickPricer] Request for item ${itemId} timed out`);
                failItem();
            },
            onabort: failItem
        });
    }

    /**
     * Get {marketValue, sellPrice} for an item — served from cache when fresh,
     * otherwise queued behind the rate-limited request queue. The callback is
     * always invoked exactly once (with zeros on failure).
     */
    function fetchItemData(itemId, callback) {
        const cached = getCachedPrice(itemId);
        if (cached) {
            callback({ marketValue: cached.marketValue, sellPrice: cached.sellPrice });
            return;
        }
        // Dedupe: if this item is already queued or in flight, piggyback on it.
        if (pendingRequests.has(itemId)) {
            pendingRequests.get(itemId).push(callback);
            return;
        }
        // A halted queue gets a fresh chance once the previous run has fully drained
        // (e.g. the user fixed their API key in Settings).
        if (queueHalted && requestQueue.length === 0 && pendingRequests.size === 0) {
            queueHalted = false;
        }
        pendingRequests.set(itemId, [callback]);
        requestQueue.push({ itemId, retries: 0 });
        processRequestQueue();
    }

    // =====================================================================
    // PRICING LOGIC
    // =====================================================================

    /**
     * Market value minus discount, floored at the NPC sell price unless the
     * user disabled floor enforcement.
     */
    function calculateFinalPrice(marketValue, sellPrice, discount) {
        let finalPrice = Math.round(marketValue * (1 - clampDiscount(discount) / 100));
        if (!CONFIG.disableNpcCheck && sellPrice > 0 && finalPrice < sellPrice) {
            log(`Price ${finalPrice} below NPC sell price ${sellPrice}, adjusting...`);
            finalPrice = sellPrice;
        }
        return finalPrice;
    }

    function clearItemInputs(itemElement) {
        const amountDiv = itemElement.querySelector(SELECTORS.amountWrap);
        const priceDiv = itemElement.querySelector(SELECTORS.priceWrap);
        if (priceDiv) {
            priceDiv.querySelectorAll('input').forEach(input => {
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }
        if (amountDiv) {
            const isQuantityCheckbox = amountDiv.querySelector(SELECTORS.quantityCheckbox);
            if (isQuantityCheckbox) {
                const checkbox = isQuantityCheckbox.querySelector('input');
                if (checkbox && checkbox.checked) checkbox.click();
            } else {
                const quantityInput = amountDiv.querySelector('input');
                if (quantityInput) {
                    quantityInput.value = '';
                    quantityInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        }
    }

    /**
     * Fill one add-items row with its calculated price and quantity.
     * @returns {Promise<boolean>} true if the price was actually filled
     */
    function fillItemPrice(itemElement) {
        const image = itemElement.querySelector('img');
        if (!image) return Promise.resolve(false);
        const itemId = getItemIdFromImage(image);
        if (!itemId) return Promise.resolve(false);
        const amountDiv = itemElement.querySelector(SELECTORS.amountWrap);
        const priceDiv = itemElement.querySelector(SELECTORS.priceWrap);
        if (!priceDiv) { warnSelectorMiss('priceWrap'); return Promise.resolve(false); }
        const priceInputs = priceDiv.querySelectorAll('input');
        if (priceInputs.length === 0) return Promise.resolve(false);

        return new Promise((resolve) => {
            fetchItemData(itemId, ({ marketValue, sellPrice }) => {
                if (marketValue > 0) {
                    const finalPrice = calculateFinalPrice(marketValue, sellPrice, CONFIG.defaultDiscount);
                    priceInputs.forEach(input => {
                        input.value = finalPrice;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    });
                    if (amountDiv) {
                        const isQuantityCheckbox = amountDiv.querySelector(SELECTORS.quantityCheckbox);
                        if (isQuantityCheckbox) {
                            const checkbox = isQuantityCheckbox.querySelector('input');
                            if (checkbox && !checkbox.checked) checkbox.click();
                        } else {
                            const quantityInput = amountDiv.querySelector('input');
                            if (quantityInput) {
                                quantityInput.value = getQuantity(itemElement);
                                quantityInput.dispatchEvent(new Event('input', { bubbles: true }));
                                quantityInput.dispatchEvent(new Event('keyup', { bubbles: true }));
                            }
                        }
                    }
                    const btn = itemElement.querySelector('.quick-price-btn button');
                    if (btn) { btn.classList.add('qp-btn-red'); btn.dataset.mode = 'undo'; }
                    resolve(true);
                    return;
                } else {
                    // Surface the failure on the button instead of silently doing nothing.
                    const btn = itemElement.querySelector('.quick-price-btn button');
                    if (btn && btn.dataset.mode !== 'undo') {
                        const prevTitle = btn.title;
                        btn.classList.add('qp-btn-red');
                        btn.title = 'Price fetch failed — click to retry';
                        setTimeout(() => {
                            if (btn.dataset.mode !== 'undo') {
                                btn.classList.remove('qp-btn-red');
                                btn.title = prevTitle;
                            }
                        }, 2500);
                    }
                }
                resolve(false);
            });
        });
    }

    // =====================================================================
    // TAB / ITEM VISIBILITY
    // =====================================================================

    /** Items in the currently visible add-items list(s), excluding tab entries. */
    function getVisibleItems() {
        const allItemsLists = document.querySelectorAll(SELECTORS.itemLists);
        let visibleItems = [];
        for (const list of allItemsLists) {
            const listStyle = window.getComputedStyle(list);
            if (listStyle.display !== 'none') {
                const items = list.querySelectorAll(SELECTORS.addItems);
                visibleItems = visibleItems.concat(Array.from(items).filter(item => !item.className.includes(SELECTORS.tabItemClass)));
            }
        }
        return visibleItems;
    }

    // =====================================================================
    // MANAGE ITEMS PAGE
    // =====================================================================

    /**
     * Fetch the market price for one manage-page item and write it into the input.
     * @returns {Promise<'updated'|'declined'|'failed'>} what actually happened, so
     *          batch runs can report real counts instead of attempts.
     */
    function updateManageItemPrice(priceDiv, itemId, itemName) {
        return new Promise((resolve) => {
            const priceInput = priceDiv.querySelector(SELECTORS.managePriceInput);
            if (!priceInput) { warnSelectorMiss('managePriceInput'); resolve('failed'); return; }
            const currentPrice = parseInt(priceInput.value.replace(/,/g, ''), 10) || 0;
            priceInput.disabled = true;
            priceInput.style.opacity = '0.5';
            fetchItemData(itemId, async ({ marketValue, sellPrice }) => {
                priceInput.disabled = false;
                priceInput.style.opacity = '1';
                if (marketValue <= 0) {
                    qpToast(`Could not fetch price for ${itemName || 'this item'}`, 'error');
                    resolve('failed');
                    return;
                }
                const newPrice = calculateFinalPrice(marketValue, sellPrice, CONFIG.defaultDiscount);
                const priceDiff = Math.abs(newPrice - currentPrice);
                const percentDiff = currentPrice > 0 ? (priceDiff / currentPrice) * 100 : 100;
                if (percentDiff > CONFIG.priceDiffThreshold && currentPrice > 0) {
                    const direction = newPrice > currentPrice ? 'increase' : 'decrease';
                    const confirmed = await qpConfirm(
                        `${itemName ? itemName + '\n\n' : ''}Price ${direction} detected!\n\nCurrent: $${currentPrice.toLocaleString()}\nNew: $${newPrice.toLocaleString()}\nDifference: ${percentDiff.toFixed(1)}%\n\nUpdate to new price?`,
                        { title: 'PRICE CHECK', confirmText: 'UPDATE' }
                    );
                    if (!confirmed) { resolve('declined'); return; }
                }
                priceInput.value = newPrice;
                priceInput.dispatchEvent(new Event('input', { bubbles: true }));
                priceInput.dispatchEvent(new Event('change', { bubbles: true }));
                const borderColor = (sellPrice > 0 && newPrice === sellPrice) ? '#ff9800' : '#5F5F5F';
                priceInput.style.border = `2px solid ${borderColor}`;
                setTimeout(() => priceInput.style.border = '', 1000);
                resolve('updated');
            });
        });
    }

    /**
     * Build the per-item button container, prefixing a blinking RW badge dot
     * when the item is a ranked-war weapon. Shared by both bazaar pages.
     * @returns {{btnContainer: HTMLDivElement, btnInput: HTMLButtonElement}}
     */
    function buildItemButton(rwInfo, { containerClass, buttonClass, svg, normalTitle }) {
        const btnContainer = document.createElement('div');
        btnContainer.className = containerClass;
        const btnInput = document.createElement('button');
        btnInput.innerHTML = svg;
        btnInput.className = buttonClass;
        if (rwInfo.isRanked) {
            const dot = document.createElement('span');
            dot.className = `qp-rw-dot${rwInfo.rarity ? ` rw-${rwInfo.rarity}` : ' rw-unknown'}`;
            dot.title = rwSkipLabel(rwInfo);
            btnContainer.appendChild(dot);
            btnContainer.appendChild(btnInput);
            btnInput.title = `RW Weapon (${rwSkipLabel(rwInfo)}) — click to price manually`;
        } else {
            btnContainer.appendChild(btnInput);
            btnInput.title = normalTitle;
        }
        btnInput.setAttribute('aria-label', btnInput.title);
        return { btnContainer, btnInput };
    }

    function addUpdatePriceButton(manageItem) {
        if (processedManageItems.has(manageItem)) return;
        if (manageItem.className.includes(SELECTORS.tabItemClass)) return;
        const priceDiv = manageItem.querySelector(SELECTORS.managePriceWrap);
        if (!priceDiv) return;
        if (priceDiv.querySelector('.quick-update-price-btn')) {
            processedManageItems.add(manageItem);
            return;
        }
        processedManageItems.add(manageItem);
        const image = manageItem.querySelector('img');
        if (!image) return;
        const itemId = getItemIdFromImage(image);
        if (!itemId) return;

        const rwInfo = getRWBonusInfo(manageItem);
        const { btnContainer, btnInput } = buildItemButton(rwInfo, {
            containerClass: 'quick-update-price-btn',
            buttonClass: 'qp-btn qp-btn-update',
            svg: refreshSVG,
            normalTitle: 'Update Price'
        });

        priceDiv.style.display = 'flex';
        priceDiv.style.alignItems = 'center';
        priceDiv.appendChild(btnContainer);

        btnInput.addEventListener('click', async function(event) {
            event.stopPropagation();
            event.preventDefault();
            if (!CONFIG.apiKey) { showApiKeyPrompt(); return; }
            if (rwInfo.isRanked && !(await confirmRwPricing(rwInfo))) return;
            updateManageItemPrice(priceDiv, itemId, getItemName(manageItem));
        });
    }

    /**
     * Walk up from a matching section heading to the nearest ancestor that
     * contains item rows — used to scope queries to one bazaar section.
     */
    function findSectionContainer(matchFn) {
        const headings = Array.from(document.querySelectorAll(SELECTORS.sectionHeadings));
        const heading = headings.find(matchFn);
        if (!heading) return null;
        let node = heading.parentElement;
        for (let i = 0; i < 5 && node && node !== document.body; i++) {
            if (node.querySelector(SELECTORS.manageItems)) return node;
            node = node.parentElement;
        }
        return null;
    }

    function getManageItems() {
        // Scoped to the "Manage your Bazaar" section specifically — a plain class-based
        // selector here also matches rows in the "Add items" section (they share the
        // same item___ classnames), which was causing the chip to misdetect context and
        // fire updateAllManagePrices() on the add-items page. If the manage heading
        // isn't found, treat it as "no manage items" rather than falling back to a
        // document-wide scan, since a false negative here is harmless but a false
        // positive breaks the chip.
        const container = findSectionContainer(h =>
            h.textContent.includes('Manage your Bazaar') ||
            h.textContent.includes('Manage items') ||
            h.textContent.includes('Manage Bazaar')
        );
        if (!container) return [];
        const manageItemsList = container.querySelectorAll(SELECTORS.manageItems);
        return Array.from(manageItemsList).filter(item => !item.className.includes(SELECTORS.tabItemClass));
    }

    function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

    const LAZY_LOAD_POLL_MS = 250;
    const LAZY_LOAD_QUIET_MS = 3000;   // no new rows for this long = fully loaded
    const LAZY_LOAD_MAX_ROUNDS = 60;   // hard cap ≈ 60 chunks (~3000 rows)

    /**
     * Torn renders bazaar item lists in lazy-loaded chunks (~48 rows) as you
     * scroll, so a batch run that only reads the DOM silently misses everything
     * below the fold. Repeatedly scrolls the last rendered row into view to
     * trigger the loader until no new rows appear, then restores the scroll
     * position. @returns {Promise<Element[]>} every row, fully loaded
     */
    async function loadAllLazyItems(getItems, progressEl) {
        const originalScrollY = window.scrollY;
        for (let round = 0; round < LAZY_LOAD_MAX_ROUNDS; round++) {
            const items = getItems();
            if (items.length === 0) break;
            items[items.length - 1].scrollIntoView({ block: 'end' });
            if (progressEl) progressEl.textContent = `Loading ${items.length}…`;
            // Give the loader time to render the next chunk; a full quiet
            // window with the bottom row in view means the list is complete.
            let waited = 0;
            while (waited < LAZY_LOAD_QUIET_MS && getItems().length === items.length) {
                await sleep(LAZY_LOAD_POLL_MS);
                waited += LAZY_LOAD_POLL_MS;
            }
            if (getItems().length === items.length) break;
        }
        window.scrollTo(0, originalScrollY);
        return getItems();
    }

    async function updateAllManagePrices() {
        const updateButton = chipFillBtn;
        if (updateButton) { updateButton.disabled = true; updateButton.style.opacity = '0.5'; updateButton.textContent = 'Loading…'; }
        const restoreButton = () => {
            if (updateButton) { updateButton.disabled = false; updateButton.style.opacity = '1'; updateButton.textContent = 'Update All'; }
        };

        // Pull every lazy-loaded row into the DOM first — otherwise only the
        // currently rendered chunk (~48 items) would get new prices.
        const items = await loadAllLazyItems(getManageItems, updateButton);
        if (items.length === 0) { restoreButton(); qpToast('No items found to update!', 'error'); return; }

        // Collect the actual work first so progress and totals are accurate.
        let skippedRw = 0, skippedDollar = 0;
        const work = [];
        for (const item of items) {
            const priceDiv = item.querySelector(SELECTORS.managePriceWrap);
            const image = item.querySelector('img');
            if (!priceDiv || !image) continue;
            const itemId = getItemIdFromImage(image);
            if (!itemId) continue;
            if (CONFIG.skipRwWeapons && getRWBonusInfo(item).isRanked) { skippedRw++; continue; }
            if (CONFIG.skipDollarItems) {
                const priceInput = priceDiv.querySelector(SELECTORS.managePriceInput);
                const currentPrice = priceInput ? parseInt(priceInput.value.replace(/,/g, ''), 10) || 0 : 0;
                if (currentPrice === 1) { skippedDollar++; continue; }
            }
            work.push({ priceDiv, itemId, itemName: getItemName(item) });
        }

        let updated = 0, failed = 0, done = 0;
        for (const { priceDiv, itemId, itemName } of work) {
            done++;
            if (updateButton) updateButton.textContent = `Updating ${done}/${work.length}`;
            const result = await updateManageItemPrice(priceDiv, itemId, itemName);
            if (result === 'updated') updated++;
            else if (result === 'failed') failed++;
        }

        restoreButton();
        let msg = `Updated ${updated} of ${work.length} item price${work.length === 1 ? '' : 's'}`;
        if (skippedRw > 0) msg += ` — ${skippedRw} RW weapon${skippedRw > 1 ? 's' : ''} skipped`;
        if (skippedDollar > 0) msg += ` — ${skippedDollar} $1 item${skippedDollar > 1 ? 's' : ''} skipped`;
        if (failed > 0) msg += ` — ${failed} failed`;
        qpToast(msg, failed > 0 ? 'error' : 'success', 6000);
    }

    // =====================================================================
    // FLOATING DRAG CHIP  (replaces the old embedded "Quick Fill / Update All
    // / Settings" buttons, which Torn's desktop-top layout could clip or
    // hide entirely depending on header width. The chip lives on document.body
    // as a fixed-position element, independent of any page container, so it
    // can't be hidden by a layout it doesn't belong to. Position is
    // draggable and persisted per player via GM_setValue.)
    // =====================================================================

    let chipEl = null;
    let chipFillBtn = null;
    let chipContext = null; // 'add' | 'manage' | null

    function clampChipPosition(x, y) {
        const rect = chipEl.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width - 6;
        const maxY = window.innerHeight - rect.height - 6;
        return { x: Math.min(Math.max(x, 6), Math.max(maxX, 6)), y: Math.min(Math.max(y, 6), Math.max(maxY, 6)) };
    }

    function applyChipPosition() {
        const pos = GM_getValue('chipPosition', null);
        if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
            // Clamp to the current viewport: a position saved on a large monitor
            // must not restore off-screen on a phone.
            const { x, y } = clampChipPosition(pos.x, pos.y);
            chipEl.style.left = x + 'px';
            chipEl.style.top = y + 'px';
            chipEl.style.bottom = 'auto';
            chipEl.style.transform = 'none';
        }
        // otherwise leave the CSS default (bottom-center) in place
    }

    function createFloatingChip() {
        if (chipEl) return;
        // Defensive cleanup: if the script gets re-injected (PDA re-injection, SPA route
        // change) without a full page reload, a previous instance's chip can be orphaned
        // in the DOM with no reference to clean it up. Sweep those out before making a new one.
        document.querySelectorAll('.qp-chip').forEach(el => el.remove());
        chipEl = document.createElement('div');
        chipEl.className = 'qp-chip';
        chipEl.innerHTML = `
            <div class="qp-chip-grip" id="qpChipGrip" title="Drag to reposition" role="button" tabindex="0" aria-label="Move chip (use arrow keys)">⋮⋮</div>
            <button class="qp-btn qp-chip-fill" id="qpChipFill">Quick Fill</button>
            <div class="qp-chip-divider"></div>
            <button class="qp-btn qp-chip-gear" id="qpChipGear" title="Settings" aria-label="Settings">${gearSVG}</button>
        `;
        document.body.appendChild(chipEl);
        chipFillBtn = chipEl.querySelector('#qpChipFill');

        applyChipPosition();

        chipEl.querySelector('#qpChipGear').addEventListener('click', (e) => {
            e.preventDefault();
            showSettingsPanel();
        });

        chipFillBtn.addEventListener('click', () => {
            if (!CONFIG.apiKey) { showApiKeyPrompt(); return; }
            if (chipContext === 'manage') updateAllManagePrices();
            else fillAllItems();
        });

        // Drag handling via Pointer Events (covers mouse + touch/stylus in one API)
        const grip = chipEl.querySelector('#qpChipGrip');
        let dragOffsetX = 0, dragOffsetY = 0, dragging = false;

        grip.addEventListener('pointerdown', (e) => {
            dragging = true;
            chipEl.classList.add('qp-chip-dragging');
            const rect = chipEl.getBoundingClientRect();
            // Lock in current pixel position before dragging so left/top math is stable
            chipEl.style.left = rect.left + 'px';
            chipEl.style.top = rect.top + 'px';
            chipEl.style.bottom = 'auto';
            chipEl.style.transform = 'none';
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
            grip.setPointerCapture(e.pointerId);
        });
        grip.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const { x, y } = clampChipPosition(e.clientX - dragOffsetX, e.clientY - dragOffsetY);
            chipEl.style.left = x + 'px';
            chipEl.style.top = y + 'px';
        });
        const endDrag = (e) => {
            if (!dragging) return;
            dragging = false;
            chipEl.classList.remove('qp-chip-dragging');
            const rect = chipEl.getBoundingClientRect();
            GM_setValue('chipPosition', { x: rect.left, y: rect.top });
        };
        grip.addEventListener('pointerup', endDrag);
        grip.addEventListener('pointercancel', endDrag);

        // Keyboard repositioning for the grip (paired with its role="button")
        grip.addEventListener('keydown', (e) => {
            const step = 10;
            let dx = 0, dy = 0;
            if (e.key === 'ArrowLeft') dx = -step;
            else if (e.key === 'ArrowRight') dx = step;
            else if (e.key === 'ArrowUp') dy = -step;
            else if (e.key === 'ArrowDown') dy = step;
            else return;
            e.preventDefault();
            const rect = chipEl.getBoundingClientRect();
            chipEl.style.bottom = 'auto';
            chipEl.style.transform = 'none';
            const { x, y } = clampChipPosition(rect.left + dx, rect.top + dy);
            chipEl.style.left = x + 'px';
            chipEl.style.top = y + 'px';
            GM_setValue('chipPosition', { x, y });
        });

        window.addEventListener('resize', () => {
            if (!chipEl) return;
            const pos = GM_getValue('chipPosition', null);
            if (!pos) return;
            const { x, y } = clampChipPosition(pos.x, pos.y);
            chipEl.style.left = x + 'px';
            chipEl.style.top = y + 'px';
        });
    }

    function updateChipContext() {
        if (!chipEl) return;
        // A running batch owns the button label (progress text) — don't clobber it.
        if (chipFillBtn && chipFillBtn.disabled) return;
        const manageCount = getManageItems().length;
        if (manageCount > 0) {
            chipContext = 'manage';
            chipFillBtn.textContent = 'Update All';
            return;
        }
        const addCount = getVisibleItems().length;
        if (addCount > 0) {
            chipContext = 'add';
            chipFillBtn.textContent = 'Quick Fill';
        }
        // if neither section has items yet (still loading), keep the last known context
    }

    function processManageItems() {
        const items = getManageItems();
        if (items.length > 0) items.forEach(item => addUpdatePriceButton(item));
    }

    // =====================================================================
    // ADD ITEMS PAGE
    // =====================================================================

    function addQuickPriceButton(itemElement) {
        if (processedItems.has(itemElement)) return;
        const descriptionCont = itemElement.querySelector(SELECTORS.itemDescription);
        if (!descriptionCont) return;
        if (descriptionCont.querySelector('.quick-price-btn')) { processedItems.add(itemElement); return; }
        processedItems.add(itemElement);
        const image = itemElement.querySelector(SELECTORS.itemImage);
        if (!image) return;
        const itemId = getItemIdFromImage(image);
        if (!itemId) return;
        const amountDiv = itemElement.querySelector('div.amount-main-wrap');
        if (!amountDiv) return;
        const priceInputs = amountDiv.querySelectorAll(SELECTORS.priceInputs);
        if (priceInputs.length === 0) return;

        const rwInfo = getRWBonusInfo(itemElement);
        const { btnContainer, btnInput } = buildItemButton(rwInfo, {
            containerClass: 'quick-price-btn',
            buttonClass: 'qp-btn',
            svg: addButtonSVG,
            normalTitle: 'Quick Add / Undo'
        });
        btnInput.dataset.mode = 'add';

        descriptionCont.style.display = 'flex';
        descriptionCont.style.alignItems = 'center';
        descriptionCont.appendChild(btnContainer);

        btnInput.addEventListener('click', async function(event) {
            event.stopPropagation();
            if (btnInput.dataset.mode === 'undo') {
                clearItemInputs(itemElement);
                btnInput.classList.remove('qp-btn-red');
                btnInput.dataset.mode = 'add';
                return;
            }
            if (!CONFIG.apiKey) { showApiKeyPrompt(); return; }
            if (rwInfo.isRanked && !(await confirmRwPricing(rwInfo))) return;
            btnInput.disabled = true;
            btnInput.style.opacity = '0.5';
            fillItemPrice(itemElement).then(() => { btnInput.disabled = false; btnInput.style.opacity = '1'; });
        });
    }

    async function fillAllItems() {
        const fillButton = chipFillBtn;
        if (fillButton) { fillButton.disabled = true; fillButton.style.opacity = '0.5'; fillButton.textContent = 'Loading…'; }
        // Same lazy-loader workaround as Update All: rows below the fold aren't
        // in the DOM until scrolled to.
        const items = await loadAllLazyItems(getVisibleItems, fillButton);
        if (items.length === 0) {
            if (fillButton) { fillButton.disabled = false; fillButton.style.opacity = '1'; fillButton.textContent = 'Quick Fill'; }
            qpToast('No items found to fill!', 'error');
            return;
        }
        let skippedRw = 0;
        const toFill = items.filter(item => {
            if (CONFIG.skipRwWeapons && getRWBonusInfo(item).isRanked) { skippedRw++; return false; }
            return true;
        });
        if (fillButton) fillButton.textContent = `Filling 0/${toFill.length}`;
        let completed = 0, filled = 0;
        const promises = toFill.map(item => fillItemPrice(item).then((ok) => {
            completed++;
            if (ok) filled++;
            if (fillButton) fillButton.textContent = `Filling ${completed}/${toFill.length}`;
        }));
        await Promise.all(promises);
        if (fillButton) { fillButton.disabled = false; fillButton.style.opacity = '1'; fillButton.textContent = 'Quick Fill'; }
        const failedCount = toFill.length - filled;
        let msg = `Filled ${filled} of ${toFill.length} item${toFill.length === 1 ? '' : 's'}`;
        if (skippedRw > 0) msg += ` — ${skippedRw} RW weapon${skippedRw > 1 ? 's' : ''} skipped`;
        if (failedCount > 0) msg += ` — ${failedCount} failed`;
        qpToast(msg, failedCount > 0 ? 'error' : 'success', 6000);
    }

    // =====================================================================
    // ITEM PROCESSING
    // =====================================================================

    function processAllItems() {
        const items = document.querySelectorAll(SELECTORS.allAddItems);
        if (items.length > 0) {
            items.forEach(item => {
                if (!item.className.includes(SELECTORS.tabItemClass)) addQuickPriceButton(item);
            });
        }
    }

    // =====================================================================
    // OBSERVER & INIT
    // =====================================================================

    let bazaarObserver = null;

    function setupObserver(bazaarRoot) {
        if (bazaarObserver) bazaarObserver.disconnect();
        bazaarObserver = new MutationObserver(() => {
            clearTimeout(mutationDebounceTimer);
            mutationDebounceTimer = setTimeout(() => {
                processAllItems();
                processManageItems();
                updateChipContext();
            }, 300);
        });
        bazaarObserver.observe(bazaarRoot, { childList: true, subtree: true });
    }

    function initScript(bazaarRoot) {
        // Full init regardless of key state: the chip and item buttons stay usable
        // and simply prompt for a key when clicked, instead of the script going
        // dead until a reload if the first-run prompt is dismissed.
        processAllItems();
        setupObserver(bazaarRoot);
        processManageItems();
        createFloatingChip();
        updateChipContext();
        if (!CONFIG.apiKey) showApiKeyPrompt();
    }

    let isScriptInitialized = false;

    function init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', checkForBazaar);
        } else {
            checkForBazaar();
        }
    }

    const ROOT_WAIT_TIMEOUT_MS = 20000;

    function checkForBazaar() {
        if (isScriptInitialized) return;
        const findRoot = () =>
            document.querySelector(SELECTORS.bazaarRoot) || document.querySelector(SELECTORS.bazaarRootLegacy);
        const root = findRoot();
        if (root) {
            isScriptInitialized = true;
            initScript(root);
            return;
        }
        // Single observer with a hard timeout — @run-at document-end guarantees
        // document.body exists, and the timeout ensures the observer can't run
        // forever on a page state that never renders the bazaar.
        const observer = new MutationObserver(() => {
            if (isScriptInitialized) { observer.disconnect(); return; }
            const found = findRoot();
            if (found) {
                isScriptInitialized = true;
                observer.disconnect();
                clearTimeout(giveUpTimer);
                initScript(found);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        const giveUpTimer = setTimeout(() => {
            if (!isScriptInitialized) {
                observer.disconnect();
                console.warn(`[BazaarQuickPricer] Bazaar container not found after ${ROOT_WAIT_TIMEOUT_MS / 1000}s — giving up`);
            }
        }, ROOT_WAIT_TIMEOUT_MS);
    }

    // Test hook: under the Node test runner (jsdom + GM_* stubs) expose the pure
    // helpers and skip booting against a live page. In the browser `module` is
    // undefined, so this block is inert there and init() runs as normal.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            isValidApiKey,
            clampDiscount,
            clampThreshold,
            calculateFinalPrice,
            rwSkipLabel,
            getRWBonusInfo,
            detectRarity,
            getItemIdFromImage,
            getQuantity,
            getItemName,
            getCachedPrice,
            cachePrice,
            clearPriceCache,
            CONFIG,
            SELECTORS
        };
        return;
    }

    init();

})();
