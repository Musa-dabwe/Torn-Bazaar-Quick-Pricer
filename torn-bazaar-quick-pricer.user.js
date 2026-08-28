// ==UserScript==
// @name         Torn Bazaar Quick Pricer
// @namespace    http://tampermonkey.net/
// @version      2.9.5
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

    const VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '2.9.5';

    console.log(`[BazaarQuickPricer] v${VERSION} Starting (PDA optimized)...`);

    // Current-version changelog, shown in the changelog modal (tap the info bubble
    // on the main bazaar page). Kept in the script so the release notes travel
    // with the file instead of living only in CHANGELOG.md.
    const CHANGELOG = [
        { version: '2.9.5', date: '2026-08-28', notes: [
            'The pill-shaped floating chip is now a compact circular bubble that matches your phone’s look.',
            'Icon and colour adapt to the page: an info icon on the main bazaar view, a fill-state box on Add Items, and a refresh icon on Manage.',
            'On Add Items the bubble turns pink once every item in the category is filled, so you can see at a glance when a category is done.',
            'Tap the bubble to open the changelog (main view), quick-fill (Add Items), or update-all (Manage). Long-press to open settings.',
            'The bubble is fully draggable and remembers its position, and it hides on the Personalize page.',
        ] }
    ];

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
        // Clamped on READ as well as write: GM storage is script-private, but a
        // value edited by hand in the storage editor (or written by an older
        // version) must still come out sane — these feed straight into price
        // arithmetic and into value="" attributes in the settings HTML.
        get defaultDiscount() { return clampDiscount(getSetting('discountPercent', 0)); },
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
        // Direction of the percentage adjustment: true = N% below market (discount,
        // the default), false = N% above market (markup). Replaces the old "type a
        // negative discount" trick that got clamped away — the magnitude is always a
        // positive 0–99.9% and this flag chooses the sign.
        get priceBelowMarket() { return getSetting('priceBelowMarket', true); },
        set priceBelowMarket(val) { setSetting('priceBelowMarket', val); },
        get priceDiffThreshold() { return clampThreshold(getSetting('priceDiffThreshold', 20)); },
        set priceDiffThreshold(val) { setSetting('priceDiffThreshold', clampThreshold(val)); },
        get cacheTimeoutMin() {
            const n = parseInt(getSetting('cacheTimeoutMin', 5), 10);
            return Number.isFinite(n) ? Math.min(Math.max(n, 1), 120) : 5;
        },
        set cacheTimeoutMin(val) { setSetting('cacheTimeoutMin', val); },
        get cacheTimeout() { return Math.max(1, this.cacheTimeoutMin) * 60 * 1000; }
    };

    // =====================================================================
    // PRICE CACHE  (in-memory copy of the persisted cache; stale entries are
    // pruned at startup and writes are debounced into a single GM_setValue so
    // batch runs don't re-serialize the whole object once per item)
    // =====================================================================

    // Validate the persisted cache field-by-field on load: entries flow into
    // price arithmetic and then into input.value, so a malformed entry (hand-
    // edited storage, older version's schema) must be dropped, not propagated
    // as NaN into a live bazaar listing.
    let priceCache = (() => {
        const raw = GM_getValue('priceCache', {});
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
        const clean = {};
        for (const [id, e] of Object.entries(raw)) {
            if (e && typeof e === 'object' &&
                Number.isFinite(e.marketValue) &&
                Number.isFinite(e.sellPrice) &&
                Number.isFinite(e.timestamp)) {
                clean[id] = { marketValue: e.marketValue, sellPrice: e.sellPrice, timestamp: e.timestamp };
            }
        }
        return clean;
    })();
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
            { title: 'RW weapon detected', confirmText: 'Price it', kind: 'rw' }
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
    ['#qp-style', '#qp-font', '.qp-bubble', '.qp-toast-wrap', '.qp-overlay'].forEach(sel =>
        document.querySelectorAll(sel).forEach(el => el.remove()));

    // No third-party font request (matches the Item Finder v1.1 security pass):
    // loading fonts.googleapis.com from inside torn.com leaked every user's IP
    // and referrer to Google on each bazaar visit. The pastel design system
    // (docs/pastel-theme.md) now rides on the system display stack.
    // '#qp-font' stays in the cleanup sweep above so upgrades remove the link
    // element an older installed version may have left behind.

    const style = document.createElement('style');
    style.id = 'qp-style';
    style.textContent = `
        /* ── PASTEL DESIGN SYSTEM (shared tokens — docs/pastel-theme.md) ── */
        :root {
            --qp-accent:    #7a6bd6;
            --qp-accent-bg: #efeafd;
            --qp-ink:       #2b2740;
            --qp-muted:     #8a86a0;
            --qp-field-bg:  #f7f6fb;
            --qp-border:    #e5e1f4;
            --qp-ok:        #3aa06b;
            --qp-ok-bg:     #e4f3ec;
            --qp-danger:    #c25a5a;
            --qp-danger-bg: #fbecec;
            --qp-warn:      #c9782e;
            --qp-warn-bg:   #fdf6ec;
            --qp-rw:        #f0a35e;
            --qp-rw-bg:     #fdeeda;
            --qp-font: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        }

        @keyframes qp-pop-spring {
            0%   { transform: scale(.4) translateY(14px); opacity: 0; }
            55%  { transform: scale(1.08) translateY(-3px); opacity: 1; }
            75%  { transform: scale(.97) translateY(1px); }
            100% { transform: scale(1) translateY(0); }
        }
        @keyframes qp-toast-in {
            from { transform: translateY(12px); opacity: 0; }
            to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes qpDotBlink {
            0%, 100% { opacity: 1; }
            50%       { opacity: 0.25; }
        }

        /* ── PER-ITEM BUTTONS ── */
        .qp-item-btn {
            border: none;
            cursor: pointer;
            width: 34px; height: 34px;
            border-radius: 10px !important;
            background: var(--qp-accent) !important;
            color: #fff !important;
            display: inline-flex; align-items: center; justify-content: center;
            box-shadow: 0 3px 8px rgba(122,107,214,.3);
            transition: background .15s;
            font-family: var(--qp-font) !important;
        }
        .qp-item-btn:hover { background: #6a5ac6 !important; }
        .qp-item-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .qp-item-btn.qp-btn-red {                 /* filled → undo / fetch failed */
            background: var(--qp-danger-bg) !important;
            color: var(--qp-danger) !important;
            box-shadow: none;
        }
        .qp-item-btn.qp-btn-red:hover { background: #f6dede !important; }

        .quick-price-btn, .quick-update-price-btn {
            display: flex; align-items: center; flex-shrink: 0;
            margin-left: auto; padding-right: 5px; z-index: 10;
        }

        .qp-rw-dot {                              /* blinking RW badge next to the button */
            width: 9px; height: 9px;
            border-radius: 50% !important;
            border: 2px solid #fff;
            flex-shrink: 0;
            margin-right: 4px;
            animation: qpDotBlink 1.2s ease-in-out infinite;
            pointer-events: none;
        }
        .qp-rw-dot.rw-yellow { background: #e8c97e; }
        .qp-rw-dot.rw-orange { background: var(--qp-rw); }
        .qp-rw-dot.rw-red    { background: var(--qp-danger); }
        .qp-rw-dot.rw-unknown { background: var(--qp-accent); }

        /* ── OVERLAY + MODAL SHELL ── */
        .qp-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(43,39,64,.28);
            backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
            z-index: 99999;
            display: flex; align-items: center; justify-content: center;
            font-family: var(--qp-font);
            padding: 20px 15px;
            box-sizing: border-box;
        }
        .qp-modal {
            width: 320px; max-width: calc(100vw - 32px);
            background: #fff;
            color: var(--qp-ink);
            border-radius: 20px;
            box-shadow: 0 16px 48px rgba(43,39,64,.35);
            animation: qp-pop-spring .45s cubic-bezier(.34,1.56,.64,1) both;
            max-height: 100%;
            overflow-y: auto;
        }
        .qp-head { display: flex; align-items: center; gap: 10px; padding: 18px 18px 0; }
        .qp-head__badge {
            flex: none; width: 40px; height: 40px; border-radius: 11px;
            background: var(--qp-accent-bg);
            display: flex; align-items: center; justify-content: center;
        }
        .qp-head__badge--warn { background: var(--qp-warn-bg); font-size: 16px; }
        .qp-head__badge--rw   { background: var(--qp-rw-bg);   font-size: 16px; position: relative; }
        .qp-head__badge--rw .qp-rw-dot { position: absolute; right: -4px; top: -4px; margin: 0; width: 10px; height: 10px; background: var(--qp-rw); }
        .qp-head__title { font: 800 15px/1.15 var(--qp-font); color: var(--qp-ink); }
        .qp-head__sub   { font: 700 11.5px/1.3 var(--qp-font); color: var(--qp-muted); margin-top: 1px; }
        .qp-head__sub a { color: var(--qp-accent); font-weight: 800; text-decoration: none; }
        .qp-close {
            margin-left: auto; width: 28px; height: 28px; border-radius: 50%;
            background: #f4f2fa; border: none; cursor: pointer;
            font: 800 13px var(--qp-font); color: var(--qp-muted);
            display: flex; align-items: center; justify-content: center;
            flex: none;
        }
        .qp-close:hover { background: #e9e5f6; }
        .qp-body { padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 12px; }

        /* ── FIELDS ── */
        .qp-label { font: 800 11px var(--qp-font); letter-spacing: .5px; color: var(--qp-muted); margin-bottom: 6px; }
        .qp-field {
            display: flex; align-items: center; gap: 8px;
            background: var(--qp-field-bg);
            border: 2px solid var(--qp-border); border-radius: 12px;
            padding: 10px 12px;
        }
        .qp-field:focus-within { border-color: var(--qp-accent); }
        .qp-field input {
            flex: 1; min-width: 0; border: none; outline: none; background: transparent;
            font: 700 13px var(--qp-font); color: var(--qp-ink); letter-spacing: 1px;
        }
        .qp-eye-toggle {
            flex: none; cursor: pointer;
            color: var(--qp-muted);
            display: flex; align-items: center;
        }
        .qp-eye-toggle:hover { color: var(--qp-ink); }

        /* note strip (security hint) */
        .qp-note {
            display: flex; align-items: flex-start; gap: 8px;
            background: var(--qp-warn-bg); border-radius: 12px; padding: 10px 12px;
            font: 700 11px/1.45 var(--qp-font); color: #9a7b45;
            margin: 0;
        }

        /* number-field grid: DISCOUNT / ALERT AT / CACHE */
        .qp-numgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .qp-numcell {
            background: var(--qp-field-bg); border: 1.5px solid var(--qp-border);
            border-radius: 12px; padding: 9px 10px;
            display: block;
        }
        .qp-numcell:focus-within { border-color: var(--qp-accent); }
        .qp-numcell__label { font: 800 9.5px var(--qp-font); letter-spacing: .4px; color: var(--qp-muted); }
        .qp-numcell__row { display: flex; align-items: baseline; gap: 2px; margin-top: 3px; }
        .qp-numcell input {
            width: 100%; min-width: 0; border: none; outline: none; background: transparent;
            font: 900 16px var(--qp-font); color: var(--qp-ink); padding: 0;
        }
        .qp-numcell__unit { font: 800 11px var(--qp-font); color: var(--qp-muted); }

        /* ── TOGGLES ── */
        .qp-toggles-card { background: var(--qp-field-bg); border-radius: 14px; padding: 4px 12px; display: flex; flex-direction: column; }
        .qp-toggle-row {
            display: flex; align-items: center; justify-content: space-between; gap: 12px;
            padding: 10px 0;
        }
        .qp-toggle-row:not(:last-child) { border-bottom: 1.5px solid #edeaf6; }
        .qp-toggle-row__name { font: 800 12px var(--qp-font); color: var(--qp-ink); display: block; }
        .qp-toggle-row__desc { font: 700 10px/1.35 var(--qp-font); color: var(--qp-muted); }

        .qp-toggle {
            position: relative;
            display: inline-block;
            flex: none;
            width: 36px;
            height: 21px;
        }
        .qp-toggle input { opacity: 0; width: 0; height: 0; }
        .qp-toggle-track {
            position: absolute;
            cursor: pointer;
            top: 0; left: 0; right: 0; bottom: 0;
            background: #d9d5e8;
            border-radius: 999px !important;
            transition: background .15s;
        }
        .qp-toggle-track:before {
            position: absolute;
            content: "";
            width: 16px; height: 16px;
            left: 2.5px; top: 2.5px;
            border-radius: 50%;
            background: #fff;
            box-shadow: 0 1px 3px rgba(0,0,0,.2);
            transition: transform .15s;
        }
        input:checked + .qp-toggle-track { background: var(--qp-accent); }
        input:checked + .qp-toggle-track:before { transform: translateX(15px); }

        /* ── MODAL BUTTONS ── */
        .qp-btn-row { display: flex; gap: 8px; }
        .qp-btn {
            border: none; cursor: pointer; border-radius: 12px !important; padding: 11px 0;
            font: 900 13.5px var(--qp-font); text-align: center; flex: 1;
        }
        .qp-btn--primary {
            background: var(--qp-accent); color: #fff;
            box-shadow: 0 4px 12px rgba(122,107,214,.35);
        }
        .qp-btn--primary:hover { background: #6a5ac6; }
        .qp-btn--ghost  { background: #f4f2fa; color: var(--qp-muted); font-weight: 800; font-size: 12px; }
        .qp-btn--ghost:hover { background: #e9e5f6; }
        .qp-btn--danger { background: var(--qp-danger-bg); color: var(--qp-danger); font-weight: 800; font-size: 12px; }
        .qp-btn--danger:hover { background: #f6dede; }
        .qp-btn--rw {
            background: var(--qp-rw); color: #fff;
            box-shadow: 0 4px 12px rgba(240,163,94,.4);
        }
        .qp-help { text-align: center; font: 800 11.5px var(--qp-font); color: var(--qp-accent); text-decoration: none; }
        .qp-confirm-text {
            margin: 0;
            font: 700 12px/1.55 var(--qp-font);
            white-space: pre-line;
            color: var(--qp-ink);
        }

        /* changelog modal */
        .qp-changelog__version { font: 900 14px var(--qp-font); color: var(--qp-ink); margin: 0; display: flex; align-items: baseline; gap: 8px; }
        .qp-changelog__version span { font: 800 11px var(--qp-font); color: var(--qp-muted); }
        .qp-changelog__list { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
        .qp-changelog__list li {
            position: relative; padding-left: 16px;
            font: 700 12px/1.5 var(--qp-font); color: var(--qp-ink); list-style: none;
        }
        .qp-changelog__list li::before {
            content: "·"; position: absolute; left: 2px; top: 0;
            color: var(--qp-accent); font-weight: 900; font-size: 16px;
        }

        /* ── FLOATING BUBBLE ── */
        .qp-bubble {
            position: fixed;
            left: 50%; bottom: 24px;
            transform: translateX(-50%);
            width: 52px; height: 52px;
            border-radius: 50% !important;
            background: var(--qp-accent);
            color: #fff;
            z-index: 99998;
            box-shadow: 0 10px 26px rgba(122,107,214,.4), 0 2px 6px rgba(0,0,0,.08);
            display: flex; align-items: center; justify-content: center;
            cursor: pointer;
            touch-action: none;
            -webkit-user-select: none; user-select: none;
            transition: background .2s, box-shadow .2s, transform .15s;
        }
        .qp-bubble:active { transform: translateX(-50%) scale(.94); }
        .qp-bubble.qp-bubble-dragging {
            opacity: .9;
            box-shadow: 0 16px 38px rgba(43,39,64,.32);
            cursor: grabbing;
        }
        .qp-bubble.qp-bubble-busy { cursor: progress; }
        .qp-bubble-progress {
            font: 900 11px/1 var(--qp-font); color: #fff; user-select: none;
        }
        .qp-bubble svg {
            width: 26px; height: 26px;
            fill: #fff;
            pointer-events: none;
        }
        /* filled state on the add-items page: reddish-pink, empty-box icon */
        .qp-bubble.qp-bubble-filled {
            background: #e8467c;
            box-shadow: 0 10px 26px rgba(232,70,124,.4), 0 2px 6px rgba(0,0,0,.08);
        }
        .qp-bubble.qp-bubble-hidden { display: none; }

        /* ── TOASTS ── */
        .qp-toast-wrap {
            position: fixed;
            bottom: 70px; left: 50%;
            transform: translateX(-50%);
            z-index: 100000;
            display: flex; flex-direction: column-reverse; gap: 8px; align-items: center;
            pointer-events: none;
        }
        .qp-toast {
            display: flex; align-items: center; gap: 8px;
            background: #fff; border-radius: 999px; padding: 8px 16px 8px 10px;
            box-shadow: 0 6px 18px rgba(43,39,64,.16);
            font: 800 11.5px/1.3 var(--qp-font); color: var(--qp-ink);
            max-width: min(320px, calc(100vw - 32px));
            animation: qp-toast-in .25s cubic-bezier(.2,.9,.3,1.2) both;
        }
        .qp-toast__icon {
            flex: none; width: 20px; height: 20px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            font: 900 12px var(--qp-font);
        }
        .qp-toast-success .qp-toast__icon { background: var(--qp-ok-bg);     color: var(--qp-ok); }
        .qp-toast-error   .qp-toast__icon { background: var(--qp-danger-bg); color: var(--qp-danger); }
        .qp-toast-info    .qp-toast__icon { background: var(--qp-warn-bg);   color: var(--qp-warn); font-size: 11px; }
    `;
    document.head.appendChild(style);

    // =====================================================================
    // SVGs
    // =====================================================================

    const addButtonSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;
    const refreshSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8"/></svg>`;

    const eyeSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`;
    const eyeOffSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>`;

    // Header badge icons (accent-stroked, per the pastel design system)
    const keyBadgeSVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7a6bd6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 21 2m-4 4 3 3"/></svg>`;
    const gearBadgeSVG = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#7a6bd6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10 2.1 2.1M19.1 4.9 17 7m-10 10-2.1 2.1"/></svg>`;

    // Floating-bubble icons (see docs/assets/). Rendered centred inside .qp-bubble;
    // the bubble's own CSS colours them via fill: currentColor-white on the svg.
    const bubbleInfoSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12,0A12,12,0,1,0,24,12,12.013,12.013,0,0,0,12,0Zm0,21a9,9,0,1,1,9-9A9.011,9.011,0,0,1,12,21Z"/><path d="M11.545,9.545h-.3A1.577,1.577,0,0,0,9.64,10.938,1.5,1.5,0,0,0,11,12.532v4.65a1.5,1.5,0,0,0,3,0V12A2.455,2.455,0,0,0,11.545,9.545Z"/><path d="M11.83,8.466A1.716,1.716,0,1,0,10.114,6.75,1.715,1.715,0,0,0,11.83,8.466Z"/></svg>`;
    const bubbleBoxFullSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M23.61,10.836l-1.718-3.592c-.218-.455-.742-.678-1.219-.517l-8.677,2.896L3.307,6.728c-.477-.159-1.001,.062-1.219,.518L.436,10.719c-.477,.792-.567,1.743-.247,2.609,.31,.84,.964,1.491,1.801,1.795l-.006,2.315c0,2.157,1.373,4.065,3.419,4.747l4.365,1.456c.714,.237,1.464,.356,2.214,.356s1.5-.119,2.214-.357l4.369-1.456c2.044-.682,3.418-2.586,3.419-4.738l.006-2.322c.846-.296,1.508-.945,1.819-1.788,.316-.858,.228-1.8-.198-2.5Zm-21.416,.83l1.318-2.763,7.065,2.354-1.62,3.256c-.242,.406-.729,.584-1.174,.436l-5.081-1.695c-.298-.099-.53-.324-.639-.618-.108-.293-.078-.616,.13-.97Zm3.842,8.623c-1.228-.41-2.053-1.555-2.052-2.848l.004-1.65,3.164,1.055c1.346,.446,2.793-.09,3.559-1.372l.277-.555-.004,6.979c-.197-.04-.391-.091-.582-.154l-4.365-1.455Zm11.896-.002l-4.369,1.456c-.19,.063-.384,.115-.58,.155l.004-6.995,.319,.64c.557,.928,1.532,1.46,2.562,1.46,.318,0,.643-.051,.96-.157l3.16-1.053-.004,1.651c0,1.292-.825,2.435-2.052,2.844Zm4-7.645c-.105,.285-.331,.504-.619,.601l-5.118,1.705c-.438,.147-.935-.036-1.136-.365l-1.654-3.322,7.064-2.357,1.382,2.88c.156,.261,.187,.574,.081,.859ZM5.214,5.896c-.391-.391-.391-1.023,0-1.414L9.111,.586c.779-.779,2.049-.779,2.828,0l1.596,1.596c.753-.385,1.738-.27,2.353,.345l2.255,2.255c.391,.391,.391,1.023,0,1.414s-1.023,.391-1.414,0l-2.255-2.255-3.151,3.151c-.195,.195-.451,.293-.707,.293s-.512-.098-.707-.293c-.391-.391-.391-1.023,0-1.414l2.147-2.147-1.53-1.53-3.897,3.896c-.195,.195-.451,.293-.707,.293s-.512-.098-.707-.293Z"/></svg>`;
    const bubbleBoxSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M23.576,6.429l-1.91-3.171L12,.036,2.334,3.258,.442,6.397c-.475,.792-.563,1.742-.243,2.607,.31,.839,.964,1.488,1.8,1.793l-.008,9.844,10,3.333,10-3.333,.008-9.844c.846-.296,1.507-.946,1.819-1.788,.317-.857,.229-1.797-.242-2.582Zm-5.737-2.338l-5.831,1.946-5.833-1.951,5.825-1.942,5.839,1.946ZM2.156,7.428l1.292-2.145,7.048,2.357-1.529,2.549c-.239,.398-.735,.581-1.173,.434l-5.081-1.693c-.297-.099-.53-.324-.639-.618-.108-.293-.079-.616,.082-.883Zm1.843,4.038l3.163,1.054c1.343,.448,2.792-.088,3.521-1.302l.316-.526-.005,10.843-7-2.333,.006-7.735Zm8.994,10.068l.005-10.849,.319,.532c.556,.928,1.532,1.459,2.561,1.459,.319,0,.643-.051,.96-.157l3.161-1.053-.006,7.734-7,2.333Zm8.95-13.216c-.105,.285-.331,.503-.619,.599l-5.118,1.706c-.438,.147-.934-.035-1.173-.434l-1.526-2.543,7.051-2.353,1.305,2.167c.156,.26,.186,.573,.08,.858Z"/></svg>`;
    const bubbleRotateSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="m19,0H5C2.239,0,0,2.239,0,5v14c0,2.761,2.239,5,5,5h14c2.761,0,5-2.239,5-5V5c0-2.761-2.239-5-5-5Zm-7,20c-3.022,0-5.64-1.697-7-4.177v2.177c0,.552-.448,1-1,1h0c-.552,0-1-.448-1-1v-3c0-1.105.895-2,2-2h3c.552,0,1,.448,1,1h0c0,.552-.448,1-1,1h-1.169c1.039,1.787,2.957,3,5.169,3,2.722,0,5.02-1.823,5.751-4.312.122-.414.515-.688.947-.688h0c.653,0,1.156.622,.972,1.249-.973,3.319-4.041,5.751-7.671,5.751Zm9-11c0,1.105-.895,2-2,2h-3c-.552,0-1-.448-1-1h0c0-.552,.448-1,1-1h1.185c-1.037-1.791-2.97-3-5.185-3-2.722,0-5.02,1.823-5.751,4.312-.122,.414-.515,.688-.947,.688h0c-.653,0-1.156-.622-.972-1.249.973-3.319,4.041-5.751,7.671-5.751,3.015,0,5.639,1.679,7,4.15v-2.15c0-.552,.448-1,1-1h0c.552,0,1,.448,1,1v3Z"/></svg>`;

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
        const icon = document.createElement('span');
        icon.className = 'qp-toast__icon';
        icon.textContent = kind === 'success' ? '✓' : kind === 'error' ? '!' : 'i';
        const text = document.createElement('span');
        text.textContent = message;
        toast.appendChild(icon);
        toast.appendChild(text);
        toastWrap.appendChild(toast);
        setTimeout(() => toast.remove(), duration);
    }

    /**
     * Non-blocking replacement for window.confirm, styled like the settings modal.
     * @returns {Promise<boolean>} true if the user confirmed
     */
    function qpConfirm(message, opts = {}) {
        return new Promise((resolve) => {
            const rw = opts.kind === 'rw';
            const overlay = document.createElement('div');
            overlay.className = 'qp-overlay';
            overlay.innerHTML = `
                <div class="qp-modal">
                    <div class="qp-head">
                        <div class="qp-head__badge ${rw ? 'qp-head__badge--rw' : 'qp-head__badge--warn'}">${rw ? '🗡️<span class="qp-rw-dot"></span>' : '⚠️'}</div>
                        <div class="qp-head__title">${opts.title || 'Confirm'}</div>
                    </div>
                    <div class="qp-body">
                        <p class="qp-confirm-text"></p>
                        <div class="qp-btn-row">
                            <button class="qp-btn qp-btn--ghost" data-qp="cancel">Cancel</button>
                            <button class="qp-btn ${rw ? 'qp-btn--rw' : 'qp-btn--primary'}" data-qp="ok">${opts.confirmText || 'Confirm'}</button>
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

    /**
     * Verify a key against the Torn API and REFUSE anything above Public Only.
     * The key prompt tells players "Never paste a Full Access key into
     * third-party scripts" — this makes that a rule the script enforces rather
     * than advice it prints. key/?selections=info is itself a public selection,
     * so any working key can answer it. Also catches well-formed-but-wrong keys
     * at save time instead of as error 2 halfway through a batch run.
     * @returns {Promise<void>} resolves if the key is acceptable
     */
    function verifyKeyAccessLevel(key) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://api.torn.com/key/?selections=info&key=${encodeURIComponent(key)}&comment=BazaarQuickPricer`,
                timeout: 15000,
                onload: (response) => {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data.error) { reject(new Error(data.error.error || 'Torn rejected that key')); return; }
                        const level = Number(data.access_level);
                        if (Number.isFinite(level) && level > 1) {
                            reject(new Error(`That's a ${data.access_type || 'higher-access'} key — this script only needs Public Only. Please create one of those instead.`));
                            return;
                        }
                        resolve();
                    } catch { reject(new Error('Could not verify the key — try again')); }
                },
                onerror: () => reject(new Error('Could not reach the Torn API to verify the key')),
                ontimeout: () => reject(new Error('Key verification timed out — try again'))
            });
        });
    }

    function showApiKeyPrompt() {
        const overlay = document.createElement('div');
        overlay.className = 'qp-overlay';
        overlay.innerHTML = `
            <div class="qp-modal">
                <div class="qp-head">
                    <div class="qp-head__badge">${keyBadgeSVG}</div>
                    <div>
                        <div class="qp-head__title">Quick Pricer</div>
                        <div class="qp-head__sub">Needs your public API key</div>
                    </div>
                    <button class="qp-close" id="qpCancel" aria-label="Close">✕</button>
                </div>
                <div class="qp-body">
                    <div>
                        <div class="qp-label">PUBLIC API KEY</div>
                        <div class="qp-field">
                            <input type="password" id="qpApiKey" placeholder="ENTER KEY" autocomplete="off" spellcheck="false" aria-label="Torn API key" />
                            <div class="qp-eye-toggle" id="qpEyeToggle" role="button" tabindex="0" aria-label="Show or hide API key">${eyeSVG}</div>
                        </div>
                    </div>
                    <div class="qp-note"><span>🔒</span><span>A <strong>Public</strong>-level key is enough — the script
                    only reads item market prices. Create one at Torn &gt; Settings &gt; API Keys &gt; Create Key &gt; Public.
                    Never paste a Full Access key into third-party scripts.</span></div>
                    <button class="qp-btn qp-btn--primary" id="qpSave">Authorize</button>
                    <a class="qp-help" href="https://www.torn.com/preferences.php#tab=api" target="_blank" rel="noopener">Where do I find my key? →</a>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const apiInput = overlay.querySelector('#qpApiKey');
        wireEyeToggle(overlay, apiInput);

        const saveBtn = overlay.querySelector('#qpSave');
        saveBtn.onclick = async () => {
            const key = apiInput.value.trim();
            if (!isValidApiKey(key)) {
                qpToast('Please enter a valid 16-character alphanumeric API key', 'error');
                return;
            }
            saveBtn.disabled = true;
            saveBtn.textContent = 'Verifying…';
            try {
                await verifyKeyAccessLevel(key);
                CONFIG.apiKey = key;
                overlay.remove();
                // No reload needed: the chip, observer, and item buttons are already
                // wired up; the queue simply starts working once a key exists.
                qpToast('API key saved', 'success');
            } catch (e) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Authorize';
                qpToast(e.message, 'error', 6000);
            }
        };
        overlay.querySelector('#qpCancel').onclick = () => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        wireOverlayA11y(overlay, () => overlay.remove());
        apiInput.focus();
    }

    function showChangelog() {
        const overlay = document.createElement('div');
        overlay.className = 'qp-overlay';
        const entry = CHANGELOG[0] || { version: VERSION, date: '', notes: [] };
        const items = entry.notes.map(n => `<li>${n}</li>`).join('');
        overlay.innerHTML = `
            <div class="qp-modal">
                <div class="qp-head">
                    <div class="qp-head__badge">${bubbleInfoSVG}</div>
                    <div class="qp-head__title">What's new</div>
                    <button class="qp-close" id="qpChangelogClose" aria-label="Close">✕</button>
                </div>
                <div class="qp-body">
                    <div class="qp-head__sub" style="font-size:11.5px">Quick Pricer v${VERSION}</div>
                    <p class="qp-changelog__version">${entry.version}<span>${entry.date ? ' · ' + entry.date : ''}</span></p>
                    <ul class="qp-changelog__list">${items}</ul>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.querySelector('#qpChangelogClose').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        wireOverlayA11y(overlay, close);
        overlay.querySelector('#qpChangelogClose').focus();
    }

    function showSettingsPanel() {
        const overlay = document.createElement('div');
        overlay.className = 'qp-overlay';
        overlay.innerHTML = `
            <div class="qp-modal">
                <div class="qp-head">
                    <div class="qp-head__badge">${gearBadgeSVG}</div>
                    <div>
                        <div class="qp-head__title">Quick Pricer settings</div>
                        <div class="qp-head__sub">v${VERSION} · <a href="https://github.com/Musa-dabwe/Torn-Bazaar-Quick-Pricer" target="_blank" rel="noopener">GitHub</a></div>
                    </div>
                    <button class="qp-close" id="qpCancel" aria-label="Close">✕</button>
                </div>
                <div class="qp-body">
                    <div>
                        <div class="qp-label">API KEY</div>
                        <div class="qp-field">
                            <input type="password" id="qpApiKey" autocomplete="off" spellcheck="false" aria-label="Torn API key" />
                            <div class="qp-eye-toggle" id="qpEyeToggle" role="button" tabindex="0" aria-label="Show or hide API key">${eyeSVG}</div>
                        </div>
                    </div>
                    <div class="qp-note"><span>🔒</span><span>A <strong>Public</strong>-level key is enough — the script only reads item market data.</span></div>
                    <div class="qp-numgrid">
                        <label class="qp-numcell">
                            <span class="qp-numcell__label" id="qpDiscountLabel">${CONFIG.priceBelowMarket ? 'DISCOUNT' : 'MARKUP'}</span>
                            <span class="qp-numcell__row"><input type="number" id="qpDiscount" value="${CONFIG.defaultDiscount}" step="0.1" min="0" max="99.9" aria-label="Percent below or above market" /><span class="qp-numcell__unit">%</span></span>
                        </label>
                        <label class="qp-numcell">
                            <span class="qp-numcell__label">ALERT AT</span>
                            <span class="qp-numcell__row"><input type="number" id="qpThreshold" value="${CONFIG.priceDiffThreshold}" step="1" min="0" max="1000" aria-label="Ask before applying price changes larger than this percent" /><span class="qp-numcell__unit">%</span></span>
                        </label>
                        <label class="qp-numcell">
                            <span class="qp-numcell__label">CACHE</span>
                            <span class="qp-numcell__row"><input type="number" id="qpCacheMin" value="${CONFIG.cacheTimeoutMin}" step="1" min="1" max="120" aria-label="Price cache lifetime in minutes" /><span class="qp-numcell__unit">min</span></span>
                        </label>
                    </div>
                    <div class="qp-toggles-card">
                        <div class="qp-toggle-row">
                            <div>
                                <span class="qp-toggle-row__name">NPC floor enforcement</span>
                                <div class="qp-toggle-row__desc">Never price below the NPC sell price</div>
                            </div>
                            <label class="qp-toggle">
                                <input type="checkbox" id="qpNpcCheck" ${!CONFIG.disableNpcCheck ? 'checked' : ''} />
                                <span class="qp-toggle-track"></span>
                            </label>
                        </div>
                        <div class="qp-toggle-row">
                            <div>
                                <span class="qp-toggle-row__name">Skip RW weapons</span>
                                <div class="qp-toggle-row__desc">Ranked-war weapons have unique pricing</div>
                            </div>
                            <label class="qp-toggle">
                                <input type="checkbox" id="qpRwCheck" ${CONFIG.skipRwWeapons ? 'checked' : ''} />
                                <span class="qp-toggle-track"></span>
                            </label>
                        </div>
                        <div class="qp-toggle-row">
                            <div>
                                <span class="qp-toggle-row__name">Skip $1 items</span>
                                <div class="qp-toggle-row__desc">Update All leaves $1 giveaway listings alone</div>
                            </div>
                            <label class="qp-toggle">
                                <input type="checkbox" id="qpDollarCheck" ${CONFIG.skipDollarItems ? 'checked' : ''} />
                                <span class="qp-toggle-track"></span>
                            </label>
                        </div>
                        <div class="qp-toggle-row">
                            <div>
                                <span class="qp-toggle-row__name">Undercut market</span>
                                <div class="qp-toggle-row__desc">On: price below market · Off: above market</div>
                            </div>
                            <label class="qp-toggle">
                                <input type="checkbox" id="qpBelowMarket" ${CONFIG.priceBelowMarket ? 'checked' : ''} />
                                <span class="qp-toggle-track"></span>
                            </label>
                        </div>
                    </div>
                    <div class="qp-btn-row">
                        <button class="qp-btn qp-btn--danger" id="qpClearCache">Clear cache</button>
                        <button class="qp-btn qp-btn--primary" id="qpSave" style="flex:1.4;font-size:12.5px">Save settings</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        wireToggleRowLabel(overlay, 'qpNpcCheck');
        wireToggleRowLabel(overlay, 'qpRwCheck');
        wireToggleRowLabel(overlay, 'qpDollarCheck');
        wireToggleRowLabel(overlay, 'qpBelowMarket');

        // Keep the number-cell label honest about which direction the % applies.
        const belowMarketToggle = overlay.querySelector('#qpBelowMarket');
        const discountLabel = overlay.querySelector('#qpDiscountLabel');
        belowMarketToggle.addEventListener('change', () => {
            discountLabel.textContent = belowMarketToggle.checked ? 'DISCOUNT' : 'MARKUP';
        });

        const apiInput = overlay.querySelector('#qpApiKey');
        // Set via DOM, never string-interpolated into HTML: a malformed stored value
        // containing quotes must not be able to break out of the attribute.
        apiInput.value = CONFIG.apiKey;
        wireEyeToggle(overlay, apiInput);

        overlay.querySelector('#qpClearCache').onclick = () => {
            clearPriceCache();
            const btn = overlay.querySelector('#qpClearCache');
            btn.textContent = 'Cleared ✓';
            setTimeout(() => { btn.textContent = 'Clear cache'; }, 1500);
        };

        const settingsSaveBtn = overlay.querySelector('#qpSave');
        settingsSaveBtn.onclick = async () => {
            const key = apiInput.value.trim();
            if (key !== '' && !isValidApiKey(key)) {
                qpToast('API key must be 16 alphanumeric characters (leave empty to clear it)', 'error');
                return;
            }
            // Only round-trip to the API when the key actually changed —
            // saving unrelated settings shouldn't burn an API call.
            if (key !== '' && key !== CONFIG.apiKey) {
                settingsSaveBtn.disabled = true;
                settingsSaveBtn.textContent = 'Verifying key…';
                try {
                    await verifyKeyAccessLevel(key);
                } catch (e) {
                    settingsSaveBtn.disabled = false;
                    settingsSaveBtn.textContent = 'Save settings';
                    qpToast(e.message, 'error', 6000);
                    return; // nothing saved — fix the key or clear it, then save again
                }
            }
            CONFIG.defaultDiscount = clampDiscount(overlay.querySelector('#qpDiscount').value);
            CONFIG.priceDiffThreshold = clampThreshold(overlay.querySelector('#qpThreshold').value);
            CONFIG.apiKey = key;
            CONFIG.disableNpcCheck = !overlay.querySelector('#qpNpcCheck').checked;
            CONFIG.skipRwWeapons = overlay.querySelector('#qpRwCheck').checked;
            CONFIG.skipDollarItems = overlay.querySelector('#qpDollarCheck').checked;
            CONFIG.priceBelowMarket = overlay.querySelector('#qpBelowMarket').checked;
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
            // encodeURIComponent is technically redundant — CONFIG.apiKey only
            // ever returns a /^[a-zA-Z0-9]{16}$/ match or '' — but defense in
            // depth costs nothing, and &comment= attributes this script's
            // traffic in the player's API usage log.
            url: `https://api.torn.com/torn/${itemId}?selections=items&key=${encodeURIComponent(CONFIG.apiKey)}&comment=BazaarQuickPricer`,
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
     * Market value adjusted by the discount magnitude: N% below market when
     * priceBelowMarket is on (the default), N% above market (a markup) when it's
     * off. The magnitude is clamped to 0–99.9% in both directions, so a markup
     * tops out at +99.9% (≈2× market). Below-market results are floored at the
     * NPC sell price unless the user disabled floor enforcement; that floor can
     * never trigger for a markup (the price is already ≥ market ≥ sell price).
     */
    function calculateFinalPrice(marketValue, sellPrice, discount) {
        const pct = clampDiscount(discount) / 100;
        const multiplier = CONFIG.priceBelowMarket ? (1 - pct) : (1 + pct);
        let finalPrice = Math.round(marketValue * multiplier);
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
            const done = (val) => { updateBubbleState(); resolve(val); };
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
                    done(true);
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
                done(false);
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
                        { title: 'Big price change', confirmText: 'Update price' }
                    );
                    if (!confirmed) { resolve('declined'); return; }
                }
                priceInput.value = newPrice;
                priceInput.dispatchEvent(new Event('input', { bubbles: true }));
                priceInput.dispatchEvent(new Event('change', { bubbles: true }));
                const borderColor = (sellPrice > 0 && newPrice === sellPrice) ? '#f0a35e' : '#7a6bd6';
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
            buttonClass: 'qp-item-btn',
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

    /**
     * Torn lazy-loads bazaar rows (~48 at a time) and only renders the next
     * chunk once the last row scrolls into view, so a batch run can only see
     * the rows already in the DOM. We deliberately do NOT auto-scroll to force
     * the rest in — programmatically moving the page simulates interaction the
     * user never performed, which Torn's script rules disallow. Instead, if the
     * last rendered row still sits below the fold (so more rows may be waiting
     * to load), the caller tells the user to scroll down and run again.
     * @param {Element[]} items currently rendered rows
     * @returns {boolean} true if more rows may exist below what's loaded
     */
    function mayHaveUnloadedItems(items) {
        if (items.length === 0) return false;
        const lastRect = items[items.length - 1].getBoundingClientRect();
        return lastRect.top > window.innerHeight;
    }

    async function updateAllManagePrices() {
        // Mark the bubble busy so the user can't start a concurrent run, then show
        // live progress on the bubble. The bubble functions live below (hoisted).
        setBubbleBusy(true, '0%');
        const restore = () => { setBubbleBusy(false); };

        // Only the rows Torn has already rendered are processed. If more may be
        // waiting below the fold, we flag it in the summary so the user can
        // scroll to load them and run again (see mayHaveUnloadedItems).
        const items = getManageItems();
        if (items.length === 0) { restore(); qpToast('No items found to update!', 'error'); return; }
        const moreBelow = mayHaveUnloadedItems(items);

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
            updateBubbleProgress(`${done}/${work.length}`);
            const result = await updateManageItemPrice(priceDiv, itemId, itemName);
            if (result === 'updated') updated++;
            else if (result === 'failed') failed++;
        }

        restore();
        let msg = `Updated ${updated} of ${work.length} item price${work.length === 1 ? '' : 's'}`;
        if (skippedRw > 0) msg += ` — ${skippedRw} RW weapon${skippedRw > 1 ? 's' : ''} skipped`;
        if (skippedDollar > 0) msg += ` — ${skippedDollar} $1 item${skippedDollar > 1 ? 's' : ''} skipped`;
        if (failed > 0) msg += ` — ${failed} failed`;
        if (moreBelow) msg += ' — scroll down to load more items, then run again';
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

    // FLOATING BUBBLE  (a single circular draggable icon, replacing the old
    // pill-shaped chip. It lives on document.body as a fixed element so it
    // can't be hidden by a layout it doesn't belong to, is draggable (Pointer
    // Events), and its icon/colour/action are driven by the current sub-page
    // hash. Position persists per player via GM_setValue('chipPosition', ...).)
    // =====================================================================

    let bubbleEl = null;
    let bubbleBusy = false;          // a batch run is in progress — block re-entry

    const BUBBLE_LONG_PRESS_MS = 350;
    const BUBBLE_DRAG_THRESHOLD = 6; // px of movement before a press becomes a drag

    function getBubbleTab() {
        const h = (window.location.hash || '').trim();
        if (h.startsWith('#/add')) return 'add';
        if (h.startsWith('#/manage')) return 'manage';
        if (h.startsWith('#/personalize')) return 'personalize';
        return 'main';
    }

    function clampBubblePosition(x, y) {
        const rect = bubbleEl.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width - 6;
        const maxY = window.innerHeight - rect.height - 6;
        return { x: Math.min(Math.max(x, 6), Math.max(maxX, 6)), y: Math.min(Math.max(y, 6), Math.max(maxY, 6)) };
    }

    function applyBubblePosition() {
        const pos = GM_getValue('chipPosition', null);
        if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
            // Clamp to the current viewport: a position saved on a large monitor
            // must not restore off-screen on a phone.
            const { x, y } = clampBubblePosition(pos.x, pos.y);
            bubbleEl.style.left = x + 'px';
            bubbleEl.style.top = y + 'px';
            bubbleEl.style.bottom = 'auto';
            bubbleEl.style.transform = 'none';
        }
        // otherwise leave the CSS default (bottom-center) in place
    }

    /** True when a single add-items row has a non-empty, non-zero price entered. */
    function isItemFilled(itemElement) {
        const priceDiv = itemElement.querySelector(SELECTORS.priceWrap);
        if (!priceDiv) return false;
        const inputs = priceDiv.querySelectorAll('input');
        for (const input of inputs) {
            const raw = String(input.value || '').trim();
            if (raw === '') continue;
            const n = parseInt(raw.replace(/,/g, ''), 10);
            if (Number.isFinite(n) && n > 0) return true;
        }
        return false;
    }

    /** True when every item in the currently visible category has a price filled. */
    function isActiveCategoryFilled() {
        const items = getVisibleItems();
        if (items.length === 0) return false;
        return items.every(isItemFilled);
    }

    /** Reflect the current sub-page on the bubble: icon, background, visibility. */
    function renderBubbleContent() {
        if (!bubbleEl) return;
        if (bubbleBusy) return; // progress text is showing meanwhile
        const tab = getBubbleTab();
        bubbleEl.classList.remove('qp-bubble-filled');
        if (tab === 'personalize') {
            bubbleEl.classList.add('qp-bubble-hidden');
            return;
        }
        bubbleEl.classList.remove('qp-bubble-hidden');
        if (tab === 'add') {
            const filled = isActiveCategoryFilled();
            bubbleEl.classList.toggle('qp-bubble-filled', filled);
            bubbleEl.innerHTML = filled ? bubbleBoxSVG : bubbleBoxFullSVG;
        } else if (tab === 'manage') {
            bubbleEl.innerHTML = bubbleRotateSVG;
        } else { // main bazaar view
            bubbleEl.innerHTML = bubbleInfoSVG;
        }
    }

    /** Re-evaluate after the DOM changes / hash changes. */
    function updateBubbleState() {
        renderBubbleContent();
    }

    /** Toggle the busy state (batch run in progress) with optional progress text. */
    function setBubbleBusy(busy, progressText) {
        bubbleBusy = busy;
        if (!bubbleEl) return;
        bubbleEl.classList.toggle('qp-bubble-busy', busy);
        if (busy) {
            bubbleEl.innerHTML = `<span class="qp-bubble-progress">${progressText}</span>`;
        } else {
            renderBubbleContent();
        }
    }

    function updateBubbleProgress(text) {
        if (bubbleBusy && bubbleEl) {
            bubbleEl.innerHTML = `<span class="qp-bubble-progress">${text}</span>`;
        }
    }

    function onBubbleTap() {
        const tab = getBubbleTab();
        if (tab === 'personalize') { renderBubbleContent(); return; }
        if (tab === 'main') { showChangelog(); return; }
        if (!CONFIG.apiKey) { showApiKeyPrompt(); return; }
        if (tab === 'manage') updateAllManagePrices();
        else fillAllItems();
    }

    function onBubbleLongPress() {
        const tab = getBubbleTab();
        if (tab === 'main' || tab === 'add' || tab === 'manage') showSettingsPanel();
        // 'personalize' has no long-press action (the bubble is hidden there)
    }

    function createFloatingBubble() {
        if (bubbleEl) return;
        // Defensive cleanup: if the script gets re-injected (PDA re-injection, SPA route
        // change) without a full page reload, a previous instance's bubble can be orphaned
        // in the DOM with no reference to clean it up. Sweep those out before making a new one.
        document.querySelectorAll('.qp-bubble').forEach(el => el.remove());

        bubbleEl = document.createElement('div');
        bubbleEl.className = 'qp-bubble';
        bubbleEl.setAttribute('role', 'button');
        bubbleEl.setAttribute('tabindex', '0');
        bubbleEl.setAttribute('aria-label', 'Quick Pricer');
        bubbleEl.setAttribute('title', 'Quick Pricer');
        document.body.appendChild(bubbleEl);
        renderBubbleContent();
        applyBubblePosition();

        // Tap vs long-press vs drag, all on the one bubble surface.
        let longPressTimer = null;
        let dragging = false;
        let didLongPress = false;
        let startX = 0, startY = 0;
        let dragOffsetX = 0, dragOffsetY = 0;

        bubbleEl.addEventListener('pointerdown', (e) => {
            if (bubbleBusy) return;
            dragging = false;
            didLongPress = false;
            startX = e.clientX; startY = e.clientY;
            const rect = bubbleEl.getBoundingClientRect();
            // Lock in the current pixel position before any gesture so left/top math stays stable.
            bubbleEl.style.left = rect.left + 'px';
            bubbleEl.style.top = rect.top + 'px';
            bubbleEl.style.bottom = 'auto';
            bubbleEl.style.transform = 'none';
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
            bubbleEl.setPointerCapture(e.pointerId);
            bubbleEl.classList.add('qp-bubble-dragging');
            longPressTimer = setTimeout(() => {
                longPressTimer = null;
                didLongPress = true;
                onBubbleLongPress();
            }, BUBBLE_LONG_PRESS_MS);
        });

        bubbleEl.addEventListener('pointermove', (e) => {
            if (bubbleBusy) return;
            // Crossing the movement threshold turns the press into a drag and
            // cancels any pending long-press / tap.
            if (longPressTimer !== null &&
                (Math.abs(e.clientX - startX) > BUBBLE_DRAG_THRESHOLD ||
                 Math.abs(e.clientY - startY) > BUBBLE_DRAG_THRESHOLD)) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
                dragging = true;
                bubbleEl.classList.remove('qp-bubble-dragging');
            }
            if (!dragging) return;
            const { x, y } = clampBubblePosition(e.clientX - dragOffsetX, e.clientY - dragOffsetY);
            bubbleEl.style.left = x + 'px';
            bubbleEl.style.top = y + 'px';
        });

        const endBubbleGesture = () => {
            if (bubbleBusy) return;
            if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
            bubbleEl.classList.remove('qp-bubble-dragging');
            if (dragging) {
                dragging = false;
                const rect = bubbleEl.getBoundingClientRect();
                GM_setValue('chipPosition', { x: rect.left, y: rect.top });
                return; // a drag, not a tap
            }
            if (!didLongPress) onBubbleTap();
        };
        bubbleEl.addEventListener('pointerup', endBubbleGesture);
        bubbleEl.addEventListener('pointercancel', () => {
            if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
            bubbleEl.classList.remove('qp-bubble-dragging');
            dragging = false;
        });

        // Keyboard repositioning (paired with role="button"), matching the old grip.
        bubbleEl.addEventListener('keydown', (e) => {
            const step = 10;
            let dx = 0, dy = 0;
            if (e.key === 'ArrowLeft') dx = -step;
            else if (e.key === 'ArrowRight') dx = step;
            else if (e.key === 'ArrowUp') dy = -step;
            else if (e.key === 'ArrowDown') dy = step;
            else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBubbleTap(); return; }
            else return;
            e.preventDefault();
            const rect = bubbleEl.getBoundingClientRect();
            bubbleEl.style.bottom = 'auto';
            bubbleEl.style.transform = 'none';
            const { x, y } = clampBubblePosition(rect.left + dx, rect.top + dy);
            bubbleEl.style.left = x + 'px';
            bubbleEl.style.top = y + 'px';
            GM_setValue('chipPosition', { x, y });
        });

        bubbleEl.addEventListener('keyup', (e) => {
            // Let space activate via keydown and not double-fire on keyup.
            if (e.key === ' ') e.preventDefault();
        });

        window.addEventListener('resize', () => {
            if (!bubbleEl) return;
            const pos = GM_getValue('chipPosition', null);
            if (!pos) return;
            const { x, y } = clampBubblePosition(pos.x, pos.y);
            bubbleEl.style.left = x + 'px';
            bubbleEl.style.top = y + 'px';
        });

        // The bazaar is a hash-routed SPA — re-evaluate icon/actions on navigation.
        window.addEventListener('hashchange', updateBubbleState);
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
            buttonClass: 'qp-item-btn',
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
        setBubbleBusy(true, '0%');
        const restore = () => { setBubbleBusy(false); updateBubbleState(); };
        // Same as Update All: only the rows Torn has already rendered are
        // processed; rows below the fold aren't in the DOM until scrolled to.
        const items = getVisibleItems();
        if (items.length === 0) {
            restore();
            qpToast('No items found to fill!', 'error');
            return;
        }
        const moreBelow = mayHaveUnloadedItems(items);
        let skippedRw = 0;
        const toFill = items.filter(item => {
            if (CONFIG.skipRwWeapons && getRWBonusInfo(item).isRanked) { skippedRw++; return false; }
            return true;
        });
        let completed = 0, filled = 0;
        const promises = toFill.map(item => fillItemPrice(item).then((ok) => {
            completed++;
            if (ok) filled++;
            updateBubbleProgress(`${completed}/${toFill.length}`);
        }));
        await Promise.all(promises);
        // Refresh the bubble's fill-state icon once the batch is done.
        restore();
        const failedCount = toFill.length - filled;
        let msg = `Filled ${filled} of ${toFill.length} item${toFill.length === 1 ? '' : 's'}`;
        if (skippedRw > 0) msg += ` — ${skippedRw} RW weapon${skippedRw > 1 ? 's' : ''} skipped`;
        if (failedCount > 0) msg += ` — ${failedCount} failed`;
        if (moreBelow) msg += ' — scroll down to load more items, then run again';
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
                updateBubbleState();
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
        createFloatingBubble();
        updateBubbleState();
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
