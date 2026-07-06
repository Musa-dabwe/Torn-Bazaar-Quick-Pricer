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

    const CONFIG = {
        get defaultDiscount() { return GM_getValue('discountPercent', 0); },
        set defaultDiscount(val) { GM_setValue('discountPercent', val); },
        get apiKey() {
            // NOTE: this literal is the ONLY occurrence of the PDA placeholder in the whole
            // file. Torn PDA's script manager does a global find/replace of every occurrence
            // of "###PDA-APIKEY###" in the source with the real key before running it — so if
            // this token appears anywhere else (e.g. in a comparison), that comparison gets
            // rewritten too and silently breaks. Validate by format instead, never by string
            // equality against the token itself.
            const injected = '###PDA-APIKEY###';
            const stored = GM_getValue('tornApiKey', '');
            const isValidFormat = k => typeof k === 'string' && /^[a-zA-Z0-9]{16}$/.test(k);
            if (isValidFormat(injected) && injected !== stored) {
                GM_setValue('tornApiKey', injected); // persist so it survives even without re-injection
                return injected;
            }
            return isValidFormat(stored) ? stored : '';
        },
        set apiKey(val) { GM_setValue('tornApiKey', val); },
        get priceCache() { return GM_getValue('priceCache', {}); },
        set priceCache(val) { GM_setValue('priceCache', val); },
        get disableNpcCheck() { return GM_getValue('disableNpcCheck', false); },
        set disableNpcCheck(val) { GM_setValue('disableNpcCheck', val); },
        get skipRwWeapons() { return GM_getValue('skipRwWeapons', true); },
        set skipRwWeapons(val) { GM_setValue('skipRwWeapons', val); },
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
        .qp-btn-red { background: #E3392C !important; color: white !important; border-radius: 0 !important; }
        .qp-btn-top { padding: 5px 11px; margin-left: 5px; }
        .qp-btn-update { padding: 5px; }
        .qp-btn-settings { border-radius: 0 !important; }
        .qp-btn-fill { border-radius: 0 !important; border-right: 1px solid rgba(0,0,0,0.1); }

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
        }


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
        .qp-card input:focus { outline: none; }
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
        .qp-toggle-row:first-child { border-bottom: 1px solid var(--border); }
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

    // =====================================================================
    // UI — API KEY PROMPT  (kept minimal / unchanged)
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
                            <input type="password" id="qpApiKey" placeholder="ENTER KEY" />
                            <div class="qp-eye-toggle" id="qpEyeToggle">${eyeSVG}</div>
                        </div>
                    </div>
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
        const eyeToggle = overlay.querySelector('#qpEyeToggle');
        eyeToggle.onclick = () => {
            const isPass = apiInput.type === 'password';
            apiInput.type = isPass ? 'text' : 'password';
            eyeToggle.innerHTML = isPass ? eyeOffSVG : eyeSVG;
        };

        overlay.querySelector('#qpSave').onclick = () => {
            const key = apiInput.value.trim();
            if (key && key.length === 16) {
                CONFIG.apiKey = key;
                overlay.remove();
                location.reload();
            } else {
                alert('Please enter a valid 16-character API key');
            }
        };
        overlay.querySelector('#qpCancel').onclick = () => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
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
                            <input type="password" id="qpApiKey" value="${CONFIG.apiKey}" />
                            <div class="qp-eye-toggle" id="qpEyeToggle">${eyeSVG}</div>
                        </div>
                    </div>
                    <div class="qp-card">
                        <label>DISCOUNT %</label>
                        <input type="number" id="qpDiscount" value="${CONFIG.defaultDiscount}" step="0.1" />
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

        const apiInput = overlay.querySelector('#qpApiKey');
        const eyeToggle = overlay.querySelector('#qpEyeToggle');
        eyeToggle.onclick = () => {
            const isPass = apiInput.type === 'password';
            apiInput.type = isPass ? 'text' : 'password';
            eyeToggle.innerHTML = isPass ? eyeOffSVG : eyeSVG;
        };

        overlay.querySelector('#qpClearCache').onclick = () => {
            CONFIG.priceCache = {};
            const btn = overlay.querySelector('#qpClearCache');
            btn.textContent = 'CLEARED';
            setTimeout(() => { btn.textContent = 'CLEAR CACHE'; }, 1500);
        };

        overlay.querySelector('#qpSave').onclick = () => {
            CONFIG.defaultDiscount = parseFloat(overlay.querySelector('#qpDiscount').value) || 0;
            CONFIG.apiKey = apiInput.value.trim();
            CONFIG.disableNpcCheck = !overlay.querySelector('#qpNpcCheck').checked;
            CONFIG.skipRwWeapons = overlay.querySelector('#qpRwCheck').checked;
            overlay.remove();
        };

        overlay.querySelector('#qpCancel').onclick = () => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
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
                            CONFIG.apiKey = '';
                        }
                        callback({ marketValue: 0, sellPrice: 0 });
                    } else if (data.items?.[itemId]) {
                        const itemData = data.items[itemId];
                        const marketValue = itemData.market_value || 0;
                        const sellPrice = itemData.sell_price || 0;
                        const cache = CONFIG.priceCache;
                        cache[itemId] = { marketValue, sellPrice, timestamp: Date.now() };
                        CONFIG.priceCache = cache;
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

    function getVisibleItems() {
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

    function findSectionContainer(matchFn) {
        const headings = Array.from(document.querySelectorAll('div[role="heading"], div[class*="title"], div[class*="panelHeader"], div[class*="titleContainer"]'));
        const heading = headings.find(matchFn);
        if (!heading) return null;
        let node = heading.parentElement;
        for (let i = 0; i < 5 && node && node !== document.body; i++) {
            if (node.querySelector('div[class*="item___"]')) return node;
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
        const manageItemsList = container.querySelectorAll('div[class*="item___"]');
        return Array.from(manageItemsList).filter(item => !item.className.includes('item___UN3Mg'));
    }

    async function updateAllManagePrices() {
        const items = getManageItems();
        if (items.length === 0) { alert('No items found to update!'); return; }
        const updateButton = chipFillBtn;
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
            chipEl.style.left = pos.x + 'px';
            chipEl.style.top = pos.y + 'px';
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
            <div class="qp-chip-grip" id="qpChipGrip" title="Drag to reposition">⋮⋮</div>
            <button class="qp-btn qp-chip-fill" id="qpChipFill">Quick Fill</button>
            <div class="qp-chip-divider"></div>
            <button class="qp-btn qp-chip-gear" id="qpChipGear" title="Settings">${gearSVG}</button>
        `;
        document.body.appendChild(chipEl);
        chipFillBtn = chipEl.querySelector('#qpChipFill');

        applyChipPosition();

        chipEl.querySelector('#qpChipGear').addEventListener('click', (e) => {
            e.preventDefault();
            showSettingsPanel();
        });

        chipFillBtn.addEventListener('click', () => {
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
        const fillButton = chipFillBtn;
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
                processManageItems();
                updateChipContext();
            }, 300);
        });
        observer.observe(bazaarRoot, { childList: true, subtree: true });
    }

    function initScript(bazaarRoot) {
        if (!CONFIG.apiKey) { showApiKeyPrompt(); return; }
        processAllItems();
        setupObserver(bazaarRoot);
        processManageItems();
        createFloatingChip();
        updateChipContext();
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
