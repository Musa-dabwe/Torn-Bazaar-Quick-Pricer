// ==UserScript==
// @name         Torn Bazaar Quick Pricer
// @namespace    http://tampermonkey.net/
// @version      2.8.7
// @description  Auto-fill bazaar items with market-based pricing (PDA optimized)
// @author       Zedtrooper [3028329]
// @license      MIT
// @match        https://www.torn.com/bazaar.php*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @run-at       document-end
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

    console.log('[BazaarQuickPricer] v2.9.5 Starting (PDA optimized)...');

    // =====================================================================
    // CONFIGURATION
    // =====================================================================

    const CONFIG = {
        get defaultDiscount() { return GM_getValue('discountPercent', 0); },
        set defaultDiscount(val) { GM_setValue('discountPercent', val); },
        get apiKey() { return GM_getValue('tornApiKey', ''); },
        set apiKey(val) { GM_setValue('tornApiKey', val); },
        get lastPriceUpdate() { return GM_getValue('lastPriceUpdate', 0); },
        set lastPriceUpdate(val) { GM_setValue('lastPriceUpdate', val); },
        get priceCache() { return GM_getValue('priceCache', {}); },
        set priceCache(val) { GM_setValue('priceCache', val); },
        get disableNpcCheck() { return GM_getValue('disableNpcCheck', false); },
        set disableNpcCheck(val) { GM_setValue('disableNpcCheck', val); },
        get skipRwWeapons() { return GM_getValue('skipRwWeapons', true); },
        set skipRwWeapons(val) { GM_setValue('skipRwWeapons', val); },
        get profilePhoto() { return GM_getValue('profilePhoto', ''); },
        set profilePhoto(val) { GM_setValue('profilePhoto', val); },
        cacheTimeout: 5 * 60 * 1000
    };

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

    const RW_RARITY_KEYWORDS = ['yellow', 'orange', 'red', 'superior', 'epic', 'legendary'];

    function getRWBonusInfo(itemElement) {
        // Torn renders RW bonuses as <i class="bonus-attachment-{name}">
        // inside <li class="bonus left"> inside <ul class="bonuses-wrap">.
        const bonusIcons = itemElement.querySelectorAll(
            'ul.bonuses-wrap li.bonus i[class^="bonus-attachment-"]'
        );
        for (const icon of bonusIcons) {
            const cls = icon.className || '';
            if (cls.includes('blank-bonus')) continue;
            const match = cls.match(/bonus-attachment-([a-z0-9-]+)/i);
            if (!match) continue;
            const bonusName = match[1].toLowerCase();
            if (RW_BONUS_NAMES.has(bonusName)) {
                const rarity = detectRarity(itemElement);
                console.log(`[BazaarQuickPricer] RW detected: ${bonusName} (${rarity || 'unknown'})`);
                return { isRanked: true, bonus: bonusName, rarity };
            }
        }
        return { isRanked: false, bonus: null, rarity: null };
    }

    function detectRarity(itemElement) {
        // Rarity is encoded as glow-yellow / glow-orange / glow-red
        // on the image-wrap div inside div.title-wrap.
        const glowEl = itemElement.querySelector('div.title-wrap div.image-wrap[class*="glow-"]');
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

    // =====================================================================
    // STATE
    // =====================================================================

    const processedItems = new WeakSet();
    const processedManageItems = new WeakSet();
    let mutationDebounceTimer = null;

    // =====================================================================
    // GLOBAL CSS  (button system + badges)
    // =====================================================================

    const style = document.createElement('style');
    style.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=JetBrains+Mono:wght@400;700&display=swap');

        .qp-btn {
            background: #5F5F5F !important;
            color: white !important;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            transition: filter 0.2s;
            padding: 5px;
            font-size: 13px;
            font-weight: 700;
        }
        .qp-btn:hover { filter: brightness(0.8); }
        .qp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .qp-btn-red { background: #E3392C !important; color: white !important; }
        .qp-btn-top { padding: 5px 11px; margin-left: 5px; }
        .qp-btn-update { padding: 5px; }
        .qp-btn-settings { border-radius: 0 4px 4px 0; }
        .qp-btn-fill { border-radius: 4px 0 0 4px; border-right: 1px solid rgba(0,0,0,0.1); }
        .quick-price-btn, .quick-update-price-btn {
            display: flex; align-items: center; flex-shrink: 0;
            margin-left: auto; padding-right: 5px; z-index: 10;
        }
        /* RW indicator dot — sits to the LEFT of the fill button */
        .qp-rw-dot {
            width: 7px; height: 7px;
            border-radius: 50%;
            flex-shrink: 0;
            margin-right: 4px;
            animation: qpDotBlink 1.2s ease-in-out infinite;
            pointer-events: none;
        }
        .qp-rw-dot.rw-yellow { background: #c8a800; }
        .qp-rw-dot.rw-orange { background: #d4620a; }
        .qp-rw-dot.rw-red    { background: #c0392b; }
        .qp-rw-dot.rw-unknown { background: #7B2FBE; }
        @keyframes qpDotBlink {
            0%, 100% { opacity: 1; }
            50%       { opacity: 0.2; }
        }

        /* ── DOSSIER SETTINGS PANEL ── */
        .qp-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.85);
            z-index: 99999;
            display: flex; align-items: center; justify-content: center;
            padding: 20px; box-sizing: border-box;
            font-family: 'JetBrains Mono', 'Courier New', monospace;
        }
        /* grain */
        .qp-overlay::before {
            content: '';
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            pointer-events: none; z-index: 1;
            background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
            opacity: 0.04;
        }
        /* vignette */
        .qp-overlay::after {
            content: '';
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            pointer-events: none; z-index: 1;
            background: radial-gradient(circle, transparent 40%, rgba(0,0,0,0.75) 150%);
        }
        .qp-modal {
            position: relative; z-index: 2;
            width: 100%; max-width: 480px;
            background: #1c1b1b;
            border: 2px solid #59413d;
            box-shadow: 0 25px 60px rgba(0,0,0,0.8);
            display: flex; flex-direction: column;
            overflow: hidden;
        }
        /* header */
        .qp-modal-header {
            background: #131313;
            padding: 20px 24px 18px;
            border-bottom: 1px solid #59413d;
            position: relative; overflow: hidden;
        }
        .qp-modal-header h1 {
            font-family: 'Anton', 'Impact', sans-serif;
            font-size: 20px; letter-spacing: 4px;
            color: #ffb4a9; margin: 0 0 4px 0;
            text-transform: uppercase; line-height: 1;
        }
        .qp-timestamp {
            font-size: 11px; color: #a88a85; opacity: 0.8;
            letter-spacing: 1px;
        }
        .qp-stamp {
            position: absolute; right: -8px; top: 18px;
            transform: rotate(-12deg);
            border: 3px solid #c0392b;
            color: #c0392b;
            padding: 2px 10px;
            font-family: 'Anton', 'Impact', sans-serif;
            font-size: 9px; letter-spacing: 2px;
            text-transform: uppercase; white-space: nowrap;
            opacity: 0.85; pointer-events: none;
        }
        /* identity row */
        .qp-identity {
            display: flex; gap: 16px;
            padding: 20px 24px 0;
        }
        .qp-subject-box {
            flex: 1;
            background: #20201f;
            border: 1px solid #59413d;
            padding: 10px 12px;
        }
        .qp-subject-id {
            font-family: 'Space Mono', monospace;
            font-size: 11px; color: #ffb4a9;
            text-transform: uppercase; letter-spacing: 1px;
            margin-bottom: 6px;
        }
        .qp-subject-meta {
            font-size: 11px; color: #a88a85; line-height: 1.6;
        }
        /* mugshot */
        .qp-mugshot {
            width: 110px; height: 140px;
            position: relative;
            border: 2px solid #59413d;
            background: #2a2a2a;
            overflow: hidden;
            cursor: pointer; flex-shrink: 0;
        }
        .qp-mugshot img {
            width: 100%; height: 100%;
            object-fit: cover;
            filter: grayscale(100%) brightness(0.75) contrast(1.2);
            display: block;
        }
        .qp-mugshot-placeholder {
            width: 100%; height: 100%;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            color: #59413d; font-size: 11px;
            letter-spacing: 1px; gap: 6px;
            text-transform: uppercase;
        }
        .qp-mugshot-placeholder svg { opacity: 0.5; }
        .qp-mugshot:hover .qp-mugshot-placeholder { color: #a88a85; }
        .qp-mugshot:hover .qp-mugshot-placeholder svg { opacity: 0.9; }
        /* scanlines on mugshot */
        .qp-mugshot::before {
            content: '';
            position: absolute; inset: 0; pointer-events: none; z-index: 1;
            background: repeating-linear-gradient(
                to bottom,
                transparent 0px, transparent 1px,
                rgba(0,0,0,0.15) 1px, rgba(0,0,0,0.15) 2px
            );
        }
        .qp-wanted-banner {
            position: absolute; bottom: 0; left: 0; right: 0;
            background: #c0392b;
            color: white;
            font-family: 'Anton', 'Impact', sans-serif;
            font-size: 11px; letter-spacing: 3px;
            text-align: center; padding: 3px 0;
            text-transform: uppercase; z-index: 2;
        }
        /* settings fields */
        .qp-fields {
            padding: 16px 24px 0;
            display: flex; flex-direction: column; gap: 0;
        }
        .qp-field {
            border-bottom: 1px solid #59413d;
            padding: 10px 0;
            display: flex; flex-direction: column; gap: 4px;
        }
        .qp-field-row {
            border-bottom: 1px solid #59413d;
            padding: 10px 0;
            display: flex; align-items: center; justify-content: space-between;
        }
        .qp-field label, .qp-field-row label {
            font-family: 'Space Mono', monospace;
            font-size: 10px; color: #a88a85;
            text-transform: uppercase; letter-spacing: 2px;
            display: block; margin: 0;
        }
        .qp-field-inner {
            display: flex; align-items: center; gap: 8px;
        }
        .qp-field input[type="number"],
        .qp-field input[type="text"],
        .qp-field input[type="password"] {
            background: transparent;
            border: none; outline: none;
            font-family: 'JetBrains Mono', monospace;
            font-size: 16px; color: #ffb4a9;
            width: 100%; padding: 0;
            letter-spacing: 1px;
        }
        .qp-field input::placeholder { color: #59413d; }
        .qp-field-suffix {
            font-family: 'Space Mono', monospace;
            font-size: 12px; color: #a88a85;
        }
        .qp-eye-btn {
            background: none; border: none; cursor: pointer;
            color: #a88a85; padding: 0; line-height: 1;
            transition: color 0.2s; flex-shrink: 0;
        }
        .qp-eye-btn:hover { color: #ffb4a9; }
        /* toggle switch */
        .qp-toggle {
            position: relative; display: inline-block;
            width: 40px; height: 20px; flex-shrink: 0;
        }
        .qp-toggle input { opacity: 0; width: 0; height: 0; }
        .qp-toggle-slider {
            position: absolute; inset: 0;
            background: #2a2a2a;
            border: 1px solid #59413d;
            cursor: pointer; transition: background 0.2s;
        }
        .qp-toggle-slider::after {
            content: '';
            position: absolute;
            width: 12px; height: 12px;
            left: 4px; top: 3px;
            background: #59413d;
            transition: transform 0.2s, background 0.2s;
        }
        .qp-toggle input:checked + .qp-toggle-slider {
            background: #444c3a;
        }
        .qp-toggle input:checked + .qp-toggle-slider::after {
            transform: translateX(20px);
            background: #c1cab3;
        }
        /* footer */
        .qp-modal-footer {
            background: #0e0e0e;
            border-top: 1px solid #59413d;
            padding: 16px 24px;
        }
        .qp-footer-actions {
            display: flex; align-items: center;
            justify-content: space-between; gap: 8px;
            margin-bottom: 14px;
        }
        .qp-btn-cache {
            background: none !important;
            border: 1px solid #c0392b !important;
            color: #c0392b !important;
            font-family: 'Anton', 'Impact', sans-serif !important;
            font-size: 12px !important; letter-spacing: 2px;
            padding: 6px 12px !important;
            text-transform: uppercase; cursor: pointer;
            transition: background 0.15s, color 0.15s;
        }
        .qp-btn-cache:hover {
            background: #c0392b !important;
            color: white !important;
        }
        .qp-footer-right { display: flex; gap: 8px; }
        .qp-btn-authorize {
            background: #4a5240 !important;
            color: #c1cab3 !important;
            border: none !important;
            font-family: 'Space Mono', monospace !important;
            font-size: 11px !important; letter-spacing: 2px;
            padding: 8px 20px !important; cursor: pointer;
            text-transform: uppercase;
            transition: filter 0.15s;
        }
        .qp-btn-authorize:hover { filter: brightness(1.2); }
        .qp-btn-abort {
            background: #2a2a2a !important;
            color: #a88a85 !important;
            border: none !important;
            font-family: 'Space Mono', monospace !important;
            font-size: 11px !important; letter-spacing: 2px;
            padding: 8px 20px !important; cursor: pointer;
            text-transform: uppercase;
            transition: background 0.15s;
        }
        .qp-btn-abort:hover { background: #353535 !important; }
        .qp-footer-meta {
            display: flex; justify-content: space-between; align-items: flex-end;
            border-top: 1px solid #353535; padding-top: 10px;
        }
        .qp-version {
            font-size: 10px; color: #59413d; letter-spacing: 1px;
        }
        .qp-github-link {
            color: #59413d; text-decoration: none;
            transition: color 0.2s; line-height: 1;
        }
        .qp-github-link:hover { color: #ffb4a9; }
        /* glitch flash on btn click */
        .qp-flash { animation: qpFlash 0.1s ease; }
        @keyframes qpFlash {
            0%   { opacity: 1; }
            50%  { opacity: 0.4; }
            100% { opacity: 1; }
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
    const cameraSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="currentColor" viewBox="0 0 24 24"><path d="M12 15.2A3.2 3.2 0 1 1 12 8.8a3.2 3.2 0 0 1 0 6.4zm0-8.4A5.2 5.2 0 1 0 12 17.2 5.2 5.2 0 0 0 12 6.8zM9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9z"/></svg>`;
    const terminalSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM6.49 14.72l1.06 1.06 4.95-4.95-4.95-4.95-1.06 1.06L10.44 10.83zm4.51 1.28h6v-1.5h-6z"/></svg>`;

    const isMobile = window.innerWidth <= 784;
    let buttonsAdded = false;
    let manageButtonsAdded = false;

    function saveConfig() {} // no-op kept for compat

    // =====================================================================
    // UI — API KEY PROMPT  (kept minimal / unchanged)
    // =====================================================================

    function showApiKeyPrompt() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        overlay.innerHTML = `
            <div style="background:#2a2a2a;padding:25px;border-radius:8px;max-width:400px;width:100%;color:#fff;font-family:monospace;">
                <h2 style="margin:0 0 15px 0;color:#ffb4a9;font-size:18px;letter-spacing:3px;">QUICK PRICER SETUP</h2>
                <p style="margin:0 0 15px 0;line-height:1.5;font-size:13px;color:#a88a85;">Enter your <strong style="color:#fff;">Public API Key</strong>:</p>
                <input type="text" id="apiKeyInput" placeholder="16-character key" style="width:100%;padding:10px;margin:10px 0;border:1px solid #59413d;border-radius:0;box-sizing:border-box;background:#131313;color:#ffb4a9;font-size:14px;font-family:monospace;outline:none;">
                <div style="display:flex;gap:10px;margin-top:15px;">
                    <button id="saveApiKey" style="flex:1;padding:10px;background:#4a5240;color:#c1cab3;border:none;cursor:pointer;font-family:monospace;font-size:13px;letter-spacing:2px;text-transform:uppercase;">AUTHORIZE</button>
                    <button id="cancelApiKey" style="flex:1;padding:10px;background:#2a2a2a;color:#a88a85;border:1px solid #59413d;cursor:pointer;font-family:monospace;font-size:13px;letter-spacing:2px;text-transform:uppercase;">ABORT</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        document.getElementById('saveApiKey').onclick = () => {
            const key = document.getElementById('apiKeyInput').value.trim();
            if (key && key.length === 16) {
                CONFIG.apiKey = key;
                overlay.remove();
                location.reload();
            } else {
                alert('Please enter a valid 16-character API key');
            }
        };
        document.getElementById('cancelApiKey').onclick = () => overlay.remove();
    }

    // =====================================================================
    // UI — DOSSIER SETTINGS PANEL
    // =====================================================================

    function showSettingsPanel() {
        // Inject Google Fonts if not already present (safe to call multiple times)
        if (!document.getElementById('qp-gfonts')) {
            const link = document.createElement('link');
            link.id = 'qp-gfonts';
            link.rel = 'stylesheet';
            link.href = 'https://fonts.googleapis.com/css2?family=Anton&family=Space+Mono:wght@400;700&family=JetBrains+Mono:wght@400;700&display=swap';
            document.head.appendChild(link);
        }

        const overlay = document.createElement('div');
        overlay.className = 'qp-overlay';

        const savedPhoto = CONFIG.profilePhoto;
        const photoContent = savedPhoto
            ? `<img src="${savedPhoto}" alt="Profile" />`
            : `<div class="qp-mugshot-placeholder">${cameraSVG}<span>UPLOAD</span></div>`;

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0].replace(/-/g, '/');
        const timeStr = now.toTimeString().split(' ')[0];

        overlay.innerHTML = `
            <div class="qp-modal">

                <!-- HEADER -->
                <header class="qp-modal-header">
                    <div style="position:relative;">
                        <h1>QUICK PRICER // CLASSIFIED</h1>
                        <p class="qp-timestamp" id="qpTimestamp">LOGGED: ${dateStr} @ ${timeStr} // LOCAL_TIME</p>
                    </div>
                    <div class="qp-stamp">CONFIDENTIAL – RESTRICTED ACCESS</div>
                </header>

                <!-- IDENTITY ROW -->
                <div class="qp-identity" style="padding-bottom:4px;">
                    <div class="qp-subject-box">
                        <div class="qp-subject-id">SUBJECT ID: ZED-3028329</div>
                        <div class="qp-subject-meta">
                            Status: Active Monitoring<br/>
                            Network: Torn Item Market<br/>
                            Clearance: Bazaar Operator
                        </div>
                    </div>
                    <!-- Mugshot / photo upload -->
                    <div class="qp-mugshot" id="qpMugshot" title="Click to upload profile photo">
                        ${photoContent}
                        <div class="qp-wanted-banner">MOST WANTED</div>
                        <input type="file" id="qpPhotoInput" accept="image/*"
                               style="display:none;">
                    </div>
                </div>

                <!-- SETTINGS FIELDS -->
                <div class="qp-fields">

                    <!-- DISCOUNT % -->
                    <div class="qp-field">
                        <label>DISCOUNT %</label>
                        <div class="qp-field-inner">
                            <input type="number" id="qpDiscount"
                                   value="${CONFIG.defaultDiscount}"
                                   min="-50" max="50" step="0.5"
                                   placeholder="00" />
                            <span class="qp-field-suffix">%</span>
                        </div>
                    </div>

                    <!-- API KEY -->
                    <div class="qp-field">
                        <label>API KEY</label>
                        <div class="qp-field-inner">
                            <input type="password" id="qpApiKey"
                                   value="${CONFIG.apiKey}"
                                   placeholder="ENTER ENCRYPTION KEY" />
                            <button class="qp-eye-btn" id="qpEyeBtn" title="Toggle visibility">
                                ${eyeSVG}
                            </button>
                        </div>
                    </div>

                    <!-- NPC FLOOR -->
                    <div class="qp-field-row">
                        <label>NPC FLOOR ENFORCEMENT</label>
                        <label class="qp-toggle">
                            <input type="checkbox" id="qpNpcCheck" ${!CONFIG.disableNpcCheck ? 'checked' : ''} />
                            <span class="qp-toggle-slider"></span>
                        </label>
                    </div>

                    <!-- SKIP RW WEAPONS -->
                    <div class="qp-field-row" style="border-bottom:none;">
                        <label>SKIP RW WEAPONS</label>
                        <label class="qp-toggle">
                            <input type="checkbox" id="qpRwCheck" ${CONFIG.skipRwWeapons ? 'checked' : ''} />
                            <span class="qp-toggle-slider"></span>
                        </label>
                    </div>

                </div>

                <!-- FOOTER -->
                <footer class="qp-modal-footer">
                    <div class="qp-footer-actions">
                        <button class="qp-btn-cache" id="qpClearCache">CLEAR CACHE</button>
                        <div class="qp-footer-right">
                            <button class="qp-btn-authorize" id="qpSave">AUTHORIZE</button>
                            <button class="qp-btn-abort" id="qpCancel">ABORT</button>
                        </div>
                    </div>
                    <div class="qp-footer-meta">
                        <span class="qp-version">v2.9.5 // ZEDTROOPER [3028329]</span>
                        <a href="https://github.com/Musa-dabwe/Torn-Bazaar-Quick-Pricer"
                           target="_blank" class="qp-github-link" title="GitHub">
                            ${terminalSVG}
                        </a>
                    </div>
                </footer>

            </div>
        `;

        document.body.appendChild(overlay);

        // ── Live timestamp ──
        const tsEl = overlay.querySelector('#qpTimestamp');
        const tsInterval = setInterval(() => {
            const n = new Date();
            const d = n.toISOString().split('T')[0].replace(/-/g, '/');
            const t = n.toTimeString().split(' ')[0];
            if (tsEl) tsEl.textContent = `LOGGED: ${d} @ ${t} // LOCAL_TIME`;
        }, 1000);

        // ── Eye toggle ──
        const eyeBtn = overlay.querySelector('#qpEyeBtn');
        const apiInput = overlay.querySelector('#qpApiKey');
        let eyeVisible = false;
        eyeBtn.addEventListener('click', () => {
            eyeVisible = !eyeVisible;
            apiInput.type = eyeVisible ? 'text' : 'password';
            eyeBtn.innerHTML = eyeVisible ? eyeOffSVG : eyeSVG;
        });

        // ── Photo upload ──
        const mugshot = overlay.querySelector('#qpMugshot');
        const photoInput = overlay.querySelector('#qpPhotoInput');
        mugshot.addEventListener('click', () => photoInput.click());
        photoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const b64 = ev.target.result;
                // Replace inner content (keep wanted banner + input)
                const existingImg = mugshot.querySelector('img');
                const placeholder = mugshot.querySelector('.qp-mugshot-placeholder');
                if (existingImg) existingImg.remove();
                if (placeholder) placeholder.remove();
                const img = document.createElement('img');
                img.src = b64;
                mugshot.insertBefore(img, mugshot.querySelector('#qpPhotoInput'));
                // Persist immediately
                try { CONFIG.profilePhoto = b64; } catch(e) { /* base64 may be large */ }
            };
            reader.readAsDataURL(file);
        });

        // ── Button flash micro-interaction ──
        overlay.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.classList.add('qp-flash');
                setTimeout(() => btn.classList.remove('qp-flash'), 150);
            });
        });

        // ── Clear cache ──
        overlay.querySelector('#qpClearCache').addEventListener('click', () => {
            CONFIG.priceCache = {};
            CONFIG.lastPriceUpdate = 0;
            const btn = overlay.querySelector('#qpClearCache');
            btn.textContent = 'CACHE CLEARED';
            setTimeout(() => { btn.textContent = 'CLEAR CACHE'; }, 1500);
        });

        // ── Save ──
        overlay.querySelector('#qpSave').addEventListener('click', () => {
            CONFIG.defaultDiscount = parseFloat(overlay.querySelector('#qpDiscount').value) || 0;
            CONFIG.apiKey = overlay.querySelector('#qpApiKey').value.trim();
            // NPC floor: checkbox ON = floor ENABLED = disableNpcCheck FALSE
            CONFIG.disableNpcCheck = !overlay.querySelector('#qpNpcCheck').checked;
            CONFIG.skipRwWeapons = overlay.querySelector('#qpRwCheck').checked;
            clearInterval(tsInterval);
            overlay.remove();
        });

        // ── Cancel ──
        overlay.querySelector('#qpCancel').addEventListener('click', () => {
            clearInterval(tsInterval);
            overlay.remove();
        });

        // ── Click outside modal to close ──
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                clearInterval(tsInterval);
                overlay.remove();
            }
        });
    }

    // =====================================================================
    // HELPERS
    // =====================================================================

    const itemIdCache = new Map();
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
        const titleWrap = itemElement.querySelector('div[class*="name___"], div.title-wrap');
        if (!titleWrap) return 1;
        const match = titleWrap.textContent.match(/x(\d+)/i);
        return match ? parseInt(match[1], 10) : 1;
    }

    // =====================================================================
    // API REQUEST QUEUE
    // =====================================================================

    const requestQueue = [];
    let isProcessingQueue = false;

    function processRequestQueue() {
        if (isProcessingQueue || requestQueue.length === 0) return;
        isProcessingQueue = true;
        const { itemId, callback } = requestQueue.shift();

        GM_xmlhttpRequest({
            method: 'GET',
            url: `https://api.torn.com/torn/${itemId}?selections=items&key=${CONFIG.apiKey}`,
            onload: function(response) {
                try {
                    const data = JSON.parse(response.responseText);
                    if (data.error) {
                        if (data.error.code === 2) {
                            alert('Incorrect API Key!');
                            CONFIG.apiKey = null;
                            saveConfig();
                        }
                        callback({ marketValue: 0, sellPrice: 0 });
                    } else if (data.items?.[itemId]) {
                        const itemData = data.items[itemId];
                        const marketValue = itemData.market_value || 0;
                        const sellPrice = itemData.sell_price || 0;
                        const cache = CONFIG.priceCache;
                        cache[itemId] = { marketValue, sellPrice, timestamp: Date.now() };
                        CONFIG.priceCache = cache;
                        CONFIG.lastPriceUpdate = Date.now();
                        callback({ marketValue, sellPrice });
                    } else {
                        callback({ marketValue: 0, sellPrice: 0 });
                    }
                } catch (e) {
                    console.error('[BazaarQuickPricer] Parse error:', e);
                    callback({ marketValue: 0, sellPrice: 0 });
                }
                isProcessingQueue = false;
                setTimeout(processRequestQueue, 300);
            },
            onerror: function() {
                callback({ marketValue: 0, sellPrice: 0 });
                isProcessingQueue = false;
                setTimeout(processRequestQueue, 300);
            }
        });
    }

    function fetchItemData(itemId, callback) {
        const now = Date.now();
        const cached = CONFIG.priceCache[itemId];
        if (cached && cached.timestamp && (now - cached.timestamp < CONFIG.cacheTimeout)) {
            callback({ marketValue: cached.marketValue, sellPrice: cached.sellPrice });
            return;
        }
        requestQueue.push({ itemId, callback });
        processRequestQueue();
    }

    // =====================================================================
    // PRICING LOGIC
    // =====================================================================

    function calculateFinalPrice(marketValue, sellPrice, discount) {
        let finalPrice = Math.round(marketValue * (1 - discount / 100));
        if (!CONFIG.disableNpcCheck && sellPrice > 0 && finalPrice < sellPrice) {
            console.log(`[BazaarQuickPricer] Price ${finalPrice} below NPC sell price ${sellPrice}, adjusting...`);
            finalPrice = sellPrice;
        }
        return finalPrice;
    }

    function clearItemInputs(itemElement) {
        const amountDiv = itemElement.querySelector('div[class*="amount___"], div.amount-main-wrap');
        const priceDiv = itemElement.querySelector('div[class*="price___"], div.price');
        if (priceDiv) {
            priceDiv.querySelectorAll('input').forEach(input => {
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }
        if (amountDiv) {
            const isQuantityCheckbox = amountDiv.querySelector('div.choice-container, [class*="choiceContainer___"]');
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

    function fillItemPrice(itemElement) {
        const image = itemElement.querySelector('img');
        if (!image) return Promise.resolve();
        const itemId = getItemIdFromImage(image);
        if (!itemId) return Promise.resolve();
        const amountDiv = itemElement.querySelector('div[class*="amount___"], div.amount-main-wrap');
        const priceDiv = itemElement.querySelector('div[class*="price___"], div.price');
        if (!priceDiv) return Promise.resolve();
        const priceInputs = priceDiv.querySelectorAll('input');
        if (priceInputs.length === 0) return Promise.resolve();

        return new Promise((resolve) => {
            fetchItemData(itemId, ({ marketValue, sellPrice }) => {
                if (marketValue > 0) {
                    const finalPrice = calculateFinalPrice(marketValue, sellPrice, CONFIG.defaultDiscount);
                    priceInputs.forEach(input => {
                        input.value = finalPrice;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    });
                    if (amountDiv) {
                        const isQuantityCheckbox = amountDiv.querySelector('div.choice-container, [class*="choiceContainer___"]');
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
                }
                resolve();
            });
        });
    }

    // =====================================================================
    // TAB / ITEM VISIBILITY
    // =====================================================================

    function getActiveTab() {
        const tabs = document.querySelectorAll('ul.items-tabs li, div[class*="item___UN3Mg"]');
        for (const tab of tabs) {
            if (tab.classList.contains('active') || tab.className.includes('active___')) {
                return tab.getAttribute('data-category') || tab.textContent.trim().toLowerCase() || 'all';
            }
        }
        return 'all';
    }

    function getVisibleItems() {
        getActiveTab();
        const allItemsLists = document.querySelectorAll('ul.items-cont, div[class*="itemsContainner___"], div[class*="rowItems___"]');
        let visibleItems = [];
        for (const list of allItemsLists) {
            const listStyle = window.getComputedStyle(list);
            if (listStyle.display !== 'none') {
                const items = list.querySelectorAll('li.clearfix:not(.disabled), div[class*="item___GYCYJ"], div[class*="item___khvF6"]');
                visibleItems = visibleItems.concat(Array.from(items).filter(item => !item.className.includes('item___UN3Mg')));
            }
        }
        return visibleItems;
    }

    // =====================================================================
    // MANAGE ITEMS PAGE
    // =====================================================================

    function updateManageItemPrice(priceDiv, itemId) {
        const priceInput = priceDiv.querySelector('input.input-money, input');
        if (!priceInput) return;
        const currentPrice = parseInt(priceInput.value.replace(/,/g, '')) || 0;
        priceInput.disabled = true;
        priceInput.style.opacity = '0.5';
        fetchItemData(itemId, ({ marketValue, sellPrice }) => {
            priceInput.disabled = false;
            priceInput.style.opacity = '1';
            if (marketValue > 0) {
                const newPrice = calculateFinalPrice(marketValue, sellPrice, CONFIG.defaultDiscount);
                const priceDiff = Math.abs(newPrice - currentPrice);
                const percentDiff = currentPrice > 0 ? (priceDiff / currentPrice) * 100 : 100;
                if (percentDiff > 20 && currentPrice > 0) {
                    const direction = newPrice > currentPrice ? 'increase' : 'decrease';
                    const confirmed = confirm(
                        `Price ${direction} detected!\n\nCurrent: $${currentPrice.toLocaleString()}\nNew: $${newPrice.toLocaleString()}\nDifference: ${percentDiff.toFixed(1)}%\n\nUpdate to new price?`
                    );
                    if (!confirmed) return;
                }
                priceInput.value = newPrice;
                priceInput.dispatchEvent(new Event('input', { bubbles: true }));
                priceInput.dispatchEvent(new Event('change', { bubbles: true }));
                const borderColor = (sellPrice > 0 && newPrice === sellPrice) ? '#ff9800' : '#5F5F5F';
                priceInput.style.border = `2px solid ${borderColor}`;
                setTimeout(() => priceInput.style.border = '', 1000);
            } else {
                alert('Could not fetch price for this item');
            }
        });
    }

    function addUpdatePriceButton(manageItem) {
        if (processedManageItems.has(manageItem)) return;
        if (manageItem.className.includes('item___UN3Mg')) return;
        const priceDiv = manageItem.querySelector('div[class*="price"]');
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
        const btnContainer = document.createElement('div');
        btnContainer.className = 'quick-update-price-btn';
        const btnInput = document.createElement('button');
        btnInput.innerHTML = refreshSVG;
        btnInput.className = 'qp-btn qp-btn-update';

        if (rwInfo.isRanked) {
            const dot = document.createElement('span');
            dot.className = `qp-rw-dot${rwInfo.rarity ? ` rw-${rwInfo.rarity}` : ' rw-unknown'}`;
            dot.title = rwSkipLabel(rwInfo);
            btnContainer.appendChild(dot);
            btnContainer.appendChild(btnInput);
            btnInput.setAttribute('title', `RW Weapon (${rwSkipLabel(rwInfo)}) — click to price manually`);
        } else {
            btnContainer.appendChild(btnInput);
            btnInput.setAttribute('title', 'Update Price');
        }

        priceDiv.style.display = 'flex';
        priceDiv.style.alignItems = 'center';
        priceDiv.appendChild(btnContainer);

        btnInput.addEventListener('click', function(event) {
            event.stopPropagation();
            event.preventDefault();
            if (rwInfo.isRanked) {
                const confirmed = confirm(
                    `⚠️ RW Weapon Detected\n\nThis appears to be a ${rwSkipLabel(rwInfo)}.\nRW weapons have unique pricing not based on standard market value.\n\nPrice it anyway using the base item's market value?`
                );
                if (!confirmed) return;
            }
            updateManageItemPrice(priceDiv, itemId);
        });
    }

    function getManageItems() {
        const manageItemsList = document.querySelectorAll('div[class*="item___"]');
        return Array.from(manageItemsList).filter(item => !item.className.includes('item___UN3Mg'));
    }

    async function updateAllManagePrices() {
        const items = getManageItems();
        if (items.length === 0) { alert('No items found to update!'); return; }
        const updateButton = document.getElementById('quickUpdateAllPricesBtn');
        if (updateButton) { updateButton.disabled = true; updateButton.style.opacity = '0.5'; updateButton.textContent = 'Updating...'; }
        let updated = 0, skippedRw = 0;
        for (const item of items) {
            const priceDiv = item.querySelector('div[class*="price"]');
            const image = item.querySelector('img');
            if (priceDiv && image) {
                const itemId = getItemIdFromImage(image);
                if (itemId) {
                    if (CONFIG.skipRwWeapons) {
                        const rwInfo = getRWBonusInfo(item);
                        if (rwInfo.isRanked) { skippedRw++; continue; }
                    }
                    await new Promise((resolve) => {
                        updateManageItemPrice(priceDiv, itemId);
                        setTimeout(resolve, 350);
                    });
                    updated++;
                }
            }
        }
        if (updateButton) { updateButton.disabled = false; updateButton.style.opacity = '1'; updateButton.textContent = 'Update All'; }
        const skipMsg = skippedRw > 0 ? `\n(${skippedRw} RW weapon${skippedRw > 1 ? 's' : ''} skipped)` : '';
        alert(`Updated ${updated} item prices!${skipMsg}`);
    }

    function addManagePageButtons() {
        if (manageButtonsAdded) return;
        let attempts = 0;
        const maxAttempts = 20;
        const tryAddButtons = setInterval(() => {
            attempts++;
            const headings = Array.from(document.querySelectorAll('div[role="heading"], div[class*="title"], div[class*="panelHeader"], div[class*="titleContainer"]'));
            const manageHeading = headings.find(h => h.textContent.includes('Manage your Bazaar') || h.textContent.includes('Manage items') || h.textContent.includes('Manage Bazaar'));
            if (manageHeading) {
                if (document.getElementById('manageSettingsBtn')) { clearInterval(tryAddButtons); manageButtonsAdded = true; return; }
                clearInterval(tryAddButtons);
                manageButtonsAdded = true;
                const buttonContainer = document.createElement('div');
                buttonContainer.style.cssText = 'float:right;display:flex;gap:5px;align-items:center;margin-top:-2px;';
                const updateAllBtn = document.createElement('button');
                updateAllBtn.id = 'quickUpdateAllPricesBtn';
                updateAllBtn.textContent = 'Update All';
                updateAllBtn.className = 'qp-btn qp-btn-top';
                updateAllBtn.addEventListener('click', updateAllManagePrices);
                const settingsBtn = document.createElement('button');
                settingsBtn.id = 'manageSettingsBtn';
                settingsBtn.textContent = 'Settings';
                settingsBtn.className = 'qp-btn qp-btn-top';
                settingsBtn.addEventListener('click', (e) => { e.preventDefault(); showSettingsPanel(); });
                if (!isMobile) buttonContainer.appendChild(updateAllBtn);
                buttonContainer.appendChild(settingsBtn);
                manageHeading.appendChild(buttonContainer);
            } else if (attempts >= maxAttempts) {
                clearInterval(tryAddButtons);
            }
        }, 500);
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
        const descriptionCont = itemElement.querySelector('div[class*="description___"], div.title-wrap');
        if (!descriptionCont) return;
        if (descriptionCont.querySelector('.quick-price-btn')) { processedItems.add(itemElement); return; }
        processedItems.add(itemElement);
        const image = itemElement.querySelector('div.image-wrap img');
        if (!image) return;
        const itemId = getItemIdFromImage(image);
        if (!itemId) return;
        const amountDiv = itemElement.querySelector('div.amount-main-wrap');
        if (!amountDiv) return;
        const priceInputs = amountDiv.querySelectorAll('div.price div input');
        if (priceInputs.length === 0) return;

        const rwInfo = getRWBonusInfo(itemElement);
        const btnContainer = document.createElement('div');
        btnContainer.className = 'quick-price-btn';
        const btnInput = document.createElement('button');
        btnInput.innerHTML = addButtonSVG;
        btnInput.className = 'qp-btn';
        btnInput.dataset.mode = 'add';

        if (rwInfo.isRanked) {
            const dot = document.createElement('span');
            dot.className = `qp-rw-dot${rwInfo.rarity ? ` rw-${rwInfo.rarity}` : ' rw-unknown'}`;
            dot.title = rwSkipLabel(rwInfo);
            btnContainer.appendChild(dot);
            btnContainer.appendChild(btnInput);
            btnInput.setAttribute('title', `RW Weapon (${rwSkipLabel(rwInfo)}) — click to price manually`);
        } else {
            btnContainer.appendChild(btnInput);
            btnInput.setAttribute('title', 'Quick Add / Undo');
        }

        descriptionCont.style.display = 'flex';
        descriptionCont.style.alignItems = 'center';
        descriptionCont.appendChild(btnContainer);

        btnInput.addEventListener('click', function(event) {
            event.stopPropagation();
            if (btnInput.dataset.mode === 'undo') {
                clearItemInputs(itemElement);
                btnInput.classList.remove('qp-btn-red');
                btnInput.dataset.mode = 'add';
                return;
            }
            if (rwInfo.isRanked) {
                const confirmed = confirm(
                    `⚠️ RW Weapon Detected\n\nThis appears to be a ${rwSkipLabel(rwInfo)}.\nRW weapons have unique pricing not based on standard market value.\n\nPrice it anyway using the base item's market value?`
                );
                if (!confirmed) return;
            }
            btnInput.disabled = true;
            btnInput.style.opacity = '0.5';
            fillItemPrice(itemElement).then(() => { btnInput.disabled = false; btnInput.style.opacity = '1'; });
        });
    }

    async function fillAllItems() {
        const items = getVisibleItems();
        if (items.length === 0) { alert('No items found to fill!'); return; }
        const fillButton = document.getElementById('quickFillAllBtn');
        if (fillButton) { fillButton.disabled = true; fillButton.style.opacity = '0.5'; fillButton.textContent = 'Filling...'; }
        let skippedRw = 0;
        const promises = items.map(item => {
            if (CONFIG.skipRwWeapons) {
                const rwInfo = getRWBonusInfo(item);
                if (rwInfo.isRanked) { skippedRw++; return Promise.resolve(); }
            }
            return fillItemPrice(item);
        });
        await Promise.all(promises);
        if (fillButton) { fillButton.disabled = false; fillButton.style.opacity = '1'; fillButton.textContent = 'Quick Fill'; }
        if (skippedRw > 0) console.log(`[BazaarQuickPricer] Skipped ${skippedRw} RW weapon(s)`);
    }

    // =====================================================================
    // TOP BUTTONS  (ADD ITEMS PAGE)
    // =====================================================================

    function addTopButtons() {
        if (buttonsAdded) return;
        let attempts = 0;
        const maxAttempts = 30;
        const tryAddButtons = setInterval(() => {
            attempts++;
            const potentialHeaders = Array.from(document.querySelectorAll('div[class*="titleContainer___"], div[class*="panelHeader___"], div.title-black, div[class*="title___"]'));
            const titleSection = potentialHeaders.find(h => h.textContent.includes('Add items to your Bazaar') || h.textContent.includes('Add items'));
            if (titleSection) {
                if (document.getElementById('quickFillAllBtn')) { clearInterval(tryAddButtons); buttonsAdded = true; return; }
                clearInterval(tryAddButtons);
                buttonsAdded = true;
                const buttonContainer = document.createElement('div');
                buttonContainer.style.cssText = 'display:inline-flex;margin-left:15px;vertical-align:top;align-items:flex-start;';
                const fillAllBtn = document.createElement('button');
                fillAllBtn.id = 'quickFillAllBtn';
                fillAllBtn.textContent = 'Quick Fill';
                fillAllBtn.className = 'qp-btn qp-btn-fill';
                fillAllBtn.addEventListener('click', fillAllItems);
                const settingsBtn = document.createElement('button');
                settingsBtn.id = 'quickPricerSettingsBtn';
                settingsBtn.textContent = 'Settings';
                settingsBtn.className = 'qp-btn qp-btn-settings';
                settingsBtn.addEventListener('click', (e) => { e.preventDefault(); showSettingsPanel(); });
                buttonContainer.appendChild(fillAllBtn);
                buttonContainer.appendChild(settingsBtn);
                titleSection.appendChild(buttonContainer);
            } else if (attempts >= maxAttempts) {
                clearInterval(tryAddButtons);
            }
        }, 500);
    }

    // =====================================================================
    // ITEM PROCESSING
    // =====================================================================

    function processAllItems() {
        const items = document.querySelectorAll(
            'ul.items-cont li.clearfix:not(.disabled), ' +
            'div[class*="itemsContainner___"] div[class*="item___"], ' +
            'div[class*="rowItems___"] div[class*="item___"]'
        );
        if (items.length > 0) {
            items.forEach(item => {
                if (!item.className.includes('item___UN3Mg')) addQuickPriceButton(item);
            });
        }
    }

    // =====================================================================
    // OBSERVER & INIT
    // =====================================================================

    function setupObserver(bazaarRoot) {
        const observer = new MutationObserver(() => {
            clearTimeout(mutationDebounceTimer);
            mutationDebounceTimer = setTimeout(() => {
                processAllItems();
                addTopButtons();
                processManageItems();
                addManagePageButtons();
            }, 300);
        });
        observer.observe(bazaarRoot, { childList: true, subtree: true });
    }

    function initScript(bazaarRoot) {
        if (!CONFIG.apiKey || CONFIG.apiKey === 'null') { showApiKeyPrompt(); return; }
        processAllItems();
        setupObserver(bazaarRoot);
        addTopButtons();
        processManageItems();
        addManagePageButtons();
    }

    let isScriptInitialized = false;

    function init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', checkForBazaar);
        } else {
            checkForBazaar();
        }
    }

    function checkForBazaar() {
        if (isScriptInitialized) return;
        const bazaarRoot = document.getElementById('bazaarRoot') || document.querySelector('.bazaar-main-wrap');
        if (bazaarRoot) {
            isScriptInitialized = true;
            initScript(bazaarRoot);
            return;
        }
        const observer = new MutationObserver(() => {
            if (isScriptInitialized) { observer.disconnect(); return; }
            const root = document.getElementById('bazaarRoot') || document.querySelector('.bazaar-main-wrap');
            if (root) { isScriptInitialized = true; observer.disconnect(); initScript(root); }
        });
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        } else {
            const docObserver = new MutationObserver(() => {
                if (document.body) { docObserver.disconnect(); observer.observe(document.body, { childList: true, subtree: true }); }
            });
            docObserver.observe(document.documentElement, { childList: true });
        }
        let attempts = 0;
        const pollInterval = setInterval(() => {
            if (isScriptInitialized) { clearInterval(pollInterval); return; }
            attempts++;
            const root = document.getElementById('bazaarRoot') || document.querySelector('.bazaar-main-wrap');
            if (root) {
                isScriptInitialized = true;
                clearInterval(pollInterval);
                observer.disconnect();
                initScript(root);
            } else if (attempts > 50) {
                clearInterval(pollInterval);
                console.warn('[BazaarQuickPricer] Failed to find bazaar container after 5s');
            }
        }, 100);
    }

    init();

})();
