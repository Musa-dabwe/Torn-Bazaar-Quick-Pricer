// ==UserScript==
// @name         Torn Bazaar Quick Pricer
// @namespace    http://tampermonkey.net/
// @version      2.8.5
// @description  Auto-fill bazaar items with market-based pricing (PDA optimized)
// @author       Zedtrooper [3028329]
// @license      MIT
// @match        https://www.torn.com/bazaar.php*
// @match        https://www.torn.com/imarket.php*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @run-at       document-end
// @homepage     https://github.com/Musa-dabwe/Torn-Bazaar-Quick-Pricer
// @supportURL   https://github.com/Musa-dabwe/Torn-Bazaar-Quick-Pricer/issues
// ==/UserScript==

(function() {
    'use strict';

    console.log('[BazaarQuickPricer] v2.8.5 Starting (PDA optimized)...');

    // Configuration
    const CONFIG = {
        defaultDiscount: GM_getValue('discountPercent', 0),
        apiKey: GM_getValue('tornApiKey', ''),
        lastPriceUpdate: GM_getValue('lastPriceUpdate', 0),
        priceCache: GM_getValue('priceCache', {}),
        disableNpcCheck: GM_getValue('disableNpcCheck', false),
        cacheTimeout: 5 * 60 * 1000,
        settingsPos: GM_getValue('settingsPos', { top: '80px', left: '20px' })
    };

    const processedItems = new WeakSet();
    const processedManageItems = new WeakSet();
    let mutationDebounceTimer = null;

    // Inject Theme-Consistent CSS
    const style = document.createElement('style');
    style.textContent = `
        .qp-btn {
            background: var(--default-panel-gradient, #5F5F5F);
            color: var(--default-gray-9-color, white);
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
        .qp-btn:hover {
            filter: brightness(0.8);
        }
        .qp-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .qp-btn-red {
            background: var(--default-red-color, #E3392C) !important;
            color: white !important;
        }
        .qp-btn-top {
            padding: 5px 11px;
            margin-left: 5px;
        }
        .qp-btn-update {
            padding: 5px;
        }
        .qp-btn-settings {
            border-radius: 0 4px 4px 0;
        }
        .qp-btn-fill {
            border-radius: 4px;
        }
        .quick-price-btn, .quick-update-price-btn {
            display: flex;
            align-items: center;
            flex-shrink: 0;
            margin-left: auto;
            padding-right: 5px;
            z-index: 10;
        }
        .qp-floating-settings {
            position: fixed;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            z-index: 100000;
            cursor: move;
            padding: 0;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
            user-select: none;
        }
    `;
    document.head.appendChild(style);
    const isMobile = window.innerWidth <= 784;
    let buttonsAdded = false;
    let manageButtonsAdded = false;


    function saveConfig() {
        GM_setValue('discountPercent', CONFIG.defaultDiscount);
        GM_setValue('tornApiKey', CONFIG.apiKey);
        GM_setValue('lastPriceUpdate', CONFIG.lastPriceUpdate);
        GM_setValue('priceCache', CONFIG.priceCache);
        GM_setValue('disableNpcCheck', CONFIG.disableNpcCheck);
        GM_setValue('settingsPos', CONFIG.settingsPos);
    }

    // Custom SVGs
    const addButtonSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3,7.5v11c0,1.38,1.12,2.5,2.5,2.5h1c.83,0,1.5,.67,1.5,1.5s-.67,1.5-1.5,1.5h-1c-3.03,0-5.5-2.47-5.5-5.5V7.5C0,4.47,2.47,2,5.5,2h.35c.56-1.18,1.76-2,3.15-2h2c1.39,0,2.59,.82,3.15,2h.35c1.96,0,3.78,1.05,4.76,2.75,.42,.72,.17,1.63-.55,2.05-.24,.14-.49,.2-.75,.2-.52,0-1.02-.27-1.3-.75-.45-.77-1.28-1.25-2.17-1.25h-.35c-.56,1.18-1.76,2-3.15,2h-2c-1.39,0-2.59-.82-3.15-2h-.35c-1.38,0-2.5,1.12-2.5,2.5Zm14.5,6.5h-1c-.83,0-1.5,.67-1.5,1.5s.67,1.5,1.5,1.5h1c.83,0,1.5-.67,1.5-1.5s-.67-1.5-1.5-1.5Zm6.5-.5v6c0,2.48-2.02,4.5-4.5,4.5h-5c-2.48,0-4.5-2.02-4.5-4.5v-6c0-2.48,2.02-4.5,4.5-4.5h5c2.48,0,4.5,2.02,4.5,4.5Zm-3,0c0-.83-.67-1.5-1.5-1.5h-5c-.83,0-1.5,.67-1.5,1.5v6c0,.83,.67,1.5,1.5,1.5h5c.83,0,1.5-.67,1.5-1.5v-6Z"/></svg>`;
    const refreshSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12,2C6.48,2,2,6.48,2,12s4.48,10,10,10,10-4.48,10-10S17.52,2,12,2Zm0,18c-4.41,0-8-3.59-8-8s3.59-8,8-8,8,3.59,8,8-3.59,8-8,8Zm-1-13h2v6h-2v-6Zm0,8h2v2h-2v-2Z"/><path d="M13,7v6h4l-5,5-5-5h4V7h2Z" transform="translate(0,-1)"/></svg>`;
    const infoSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12,2A10,10,0,1,0,22,12,10,10,0,0,0,12,2Zm1,15a1,1,0,0,1-2,0V11a1,1,0,0,1,2,0ZM12,8a1.5,1.5,0,1,1,1.5-1.5A1.5,1.5,0,0,1,12,8Z"/></svg>`;
    const settingsSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19.43,12.98c0.04-0.32,0.07-0.64,0.07-0.98s-0.03-0.66-0.07-0.98l2.11-1.65c0.19-0.15,0.24-0.42,0.12-0.64l-2-3.46 c-0.12-0.22-0.39-0.31-0.61-0.22l-2.49,1c-0.52-0.4-1.08-0.73-1.69-0.98l-0.38-2.65C14.46,2.18,14.25,2,14,2h-4 C9.75,2,9.54,2.18,9.51,2.42L9.13,5.07c-0.6,0.25-1.17,0.59-1.69,0.98l-2.49-1c-0.22-0.09-0.49,0-0.61,0.22l-2,3.46 c-0.12,0.22-0.07,0.49,0.12,0.64l2.11,1.65c-0.04,0.32-0.07,0.65-0.07,0.98s0.03,0.66,0.07,0.98l-2.11,1.65 c-0.19,0.15-0.24,0.42-0.12,0.64l2,3.46c0.12,0.22,0.39,0.31,0.61,0.22l2.49-1c0.52,0.4,1.08,0.73,1.69,0.98l0.38,2.65 C9.54,21.82,9.75,22,10,22h4c0.25,0,0.46-0.18,0.49-0.42l0.38-2.65c0.61-0.25,1.17-0.59,1.69-0.98l2.49,1 c0.22,0.09,0.49,0,0.61-0.22l2-3.46c0.12-0.22,0.07-0.49-0.12-0.64L19.43,12.98z M12,15.5c-1.93,0-3.5-1.57-3.5-3.5 s1.57-3.5,3.5-3.5s3.5,1.57,3.5,3.5S13.93,15.5,12,15.5z"/></svg>`;

    function showApiKeyPrompt() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        overlay.innerHTML = `
            <div style="background:#2a2a2a;padding:25px;border-radius:8px;max-width:400px;width:100%;color:#fff;">
                <h2 style="margin:0 0 15px 0;color:#fff;font-size:18px;">Quick Pricer Setup</h2>
                <p style="margin:0 0 15px 0;line-height:1.5;font-size:14px;">Enter your <strong>Public API Key</strong>:</p>
                <input type="text" id="apiKeyInput" placeholder="API Key" style="width:100%;padding:10px;margin:10px 0;border:1px solid #555;border-radius:5px;box-sizing:border-box;background:#1a1a1a;color:#fff;font-size:14px;">
                <div style="display:flex;gap:10px;margin-top:15px;">
                    <button id="saveApiKey" style="flex:1;padding:10px;background:#4CAF50;color:white;border:none;border-radius:5px;cursor:pointer;font-size:14px;">Save</button>
                    <button id="cancelApiKey" style="flex:1;padding:10px;background:#f44336;color:white;border:none;border-radius:5px;cursor:pointer;font-size:14px;">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('saveApiKey').onclick = () => {
            const key = document.getElementById('apiKeyInput').value.trim();
            if (key && key.length === 16) {
                CONFIG.apiKey = key;
                saveConfig();
                overlay.remove();
                location.reload();
            } else {
                alert('Please enter a valid 16-character API key');
            }
        };
        document.getElementById('cancelApiKey').onclick = () => overlay.remove();
    }

    function updateFloatingSettingsVisibility() {
        const hash = window.location.hash;
        const btn = document.getElementById('qp-floating-settings');
        if (!btn) return;

        const isBazaarAdd = window.location.pathname.includes('bazaar.php') && (hash.includes('/p=add') || hash === '');
        const isBazaarManage = window.location.pathname.includes('bazaar.php') && hash.includes('/p=manage');
        const isItemMarketAdd = window.location.pathname.includes('imarket.php') && (hash.includes('/addListing') || hash.includes('/p=addListing'));

        if (isBazaarAdd || isBazaarManage || isItemMarketAdd) {
            btn.style.display = 'flex';
        } else {
            btn.style.display = 'none';
        }
    }

    function createFloatingSettingsButton() {
        if (document.getElementById('qp-floating-settings')) return;

        const btn = document.createElement('button');
        btn.id = 'qp-floating-settings';
        btn.className = 'qp-btn qp-floating-settings';
        btn.innerHTML = settingsSVG;
        btn.style.top = CONFIG.settingsPos.top;
        btn.style.left = CONFIG.settingsPos.left;
        btn.setAttribute('title', 'Quick Pricer Settings');

        let isDragging = false;
        let offsetTop, offsetLeft;

        btn.addEventListener('mousedown', (e) => {
            isDragging = true;
            offsetTop = e.clientY - btn.offsetTop;
            offsetLeft = e.clientX - btn.offsetLeft;
            btn.style.transition = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            let top = e.clientY - offsetTop;
            let left = e.clientX - offsetLeft;

            // Boundary checks
            top = Math.max(0, Math.min(window.innerHeight - 40, top));
            left = Math.max(0, Math.min(window.innerWidth - 40, left));

            btn.style.top = top + 'px';
            btn.style.left = left + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                CONFIG.settingsPos = { top: btn.style.top, left: btn.style.left };
                saveConfig();
                btn.style.transition = 'filter 0.2s';
            }
        });

        btn.addEventListener('click', (e) => {
            if (isDragging) return;
            showSettingsPanel();
        });

        document.body.appendChild(btn);
        updateFloatingSettingsVisibility();
        window.addEventListener('hashchange', updateFloatingSettingsVisibility);
    }

    function showSettingsPanel() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        overlay.innerHTML = `
            <div style="background:#2a2a2a;padding:25px;border-radius:8px;max-width:400px;width:100%;color:#fff;">
                <h2 style="margin:0 0 15px 0;font-size:18px;">Quick Pricer Settings</h2>
                
                <div style="margin:15px 0;">
                    <label style="display:block;margin-bottom:5px;font-weight:bold;font-size:14px;">Discount %:</label>
                    <input type="number" id="discountInput" value="${CONFIG.defaultDiscount}" min="-50" max="50" step="0.5" style="width:100%;padding:10px;border:1px solid #555;border-radius:5px;background:#1a1a1a;color:#fff;font-size:14px;">
                    <small style="color:#999;font-size:11px;display:block;margin-top:5px;">Use negative values to price above market (e.g., -5 for +5%)</small>
                </div>

                <div style="margin:15px 0;">
                    <label style="display:block;margin-bottom:5px;font-weight:bold;font-size:14px;">API Key:</label>
                    <input type="text" id="apiKeyUpdateInput" value="${CONFIG.apiKey}" style="width:100%;padding:10px;border:1px solid #555;border-radius:5px;background:#1a1a1a;color:#fff;font-size:14px;">
                </div>

                <div style="margin:15px 0; display:flex; align-items:center; padding: 10px; background: #222; border-radius: 5px;">
                    <input type="checkbox" id="npcOverrideCheck" ${CONFIG.disableNpcCheck ? 'checked' : ''} style="width:18px; height:18px; margin-right:10px; cursor:pointer;">
                    <label for="npcOverrideCheck" style="font-size:13px; color:#fff; cursor:pointer; flex:1;">Disable NPC Safety Limit</label>
                    <div id="npcInfoIcon" style="color:#2196F3; cursor:pointer; display:flex; align-items:center; padding: 5px;">
                        ${infoSVG}
                    </div>
                </div>

                <button id="clearCache" style="width:100%;padding:10px;background:#ff9800;color:white;border:none;border-radius:5px;cursor:pointer;font-size:14px;margin:10px 0;">Clear Cache</button>
                <div style="display:flex;gap:10px;margin-top:15px;">
                    <button id="saveSettings" style="flex:1;padding:10px;background:#4CAF50;color:white;border:none;border-radius:5px;cursor:pointer;font-size:14px;">Save</button>
                    <button id="cancelSettings" style="flex:1;padding:10px;background:#999;color:white;border:none;border-radius:5px;cursor:pointer;font-size:14px;">Cancel</button>
                </div>
                <div style="margin-top:15px;padding-top:15px;border-top:1px solid #555;text-align:center;">
                    <small style="color:#999;font-size:12px;">
                        v2.8.4 | <a href="https://github.com/Musa-dabwe/Torn-Bazaar-Quick-Pricer" target="_blank" style="color:#2196F3;">GitHub</a>
                    </small>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('npcInfoIcon').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            alert("NPC Safety Limit Explanation:\n\nChecked: Items can be priced BELOW their NPC sell value based on your discount.\n\nUnchecked (Default): The script safeguards you by ensuring you never list an item for less than you could sell it to a game shop.");
        };

        document.getElementById('clearCache').onclick = () => {
            CONFIG.priceCache = {};
            CONFIG.lastPriceUpdate = 0;
            saveConfig();
            alert('Cache cleared!');
        };
        document.getElementById('saveSettings').onclick = () => {
            CONFIG.defaultDiscount = parseFloat(document.getElementById('discountInput').value);
            CONFIG.apiKey = document.getElementById('apiKeyUpdateInput').value.trim();
            CONFIG.disableNpcCheck = document.getElementById('npcOverrideCheck').checked;
            saveConfig();
            overlay.remove();
            alert('Settings saved!');
        };
        document.getElementById('cancelSettings').onclick = () => overlay.remove();
    }

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
        // Bazaar
        const titleWrap = itemElement.querySelector('div[class*="name___"], div.title-wrap');
        if (titleWrap) {
            const match = titleWrap.textContent.match(/x(\d+)/i);
            if (match) return parseInt(match[1], 10);
        }

        // Item Market
        const amountInput = itemElement.querySelector('div[class*="amountInputWrapper___"] input');
        if (amountInput && amountInput.placeholder) {
            const match = amountInput.placeholder.match(/(\d+)/);
            if (match) return parseInt(match[1], 10);
        }

        return 1;
    }

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

                        CONFIG.priceCache[itemId] = {
                            marketValue: marketValue,
                            sellPrice: sellPrice,
                            timestamp: Date.now()
                        };
                        CONFIG.lastPriceUpdate = Date.now();
                        saveConfig();

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
            callback({
                marketValue: cached.marketValue,
                sellPrice: cached.sellPrice
            });
            return;
        }

        requestQueue.push({ itemId, callback });
        processRequestQueue();
    }

    function calculateFinalPrice(marketValue, sellPrice, discount, skipNpcCheck = false) {
        let finalPrice = Math.round(marketValue * (1 - discount / 100));
        
        // Safety Check
        if (!skipNpcCheck && !CONFIG.disableNpcCheck && sellPrice > 0 && finalPrice < sellPrice) {
            console.log(`[BazaarQuickPricer] Price ${finalPrice} below NPC sell price ${sellPrice}, adjusting...`);
            finalPrice = sellPrice;
        }

        return finalPrice;
    }

    // Helper to clear inputs
    function clearItemInputs(itemElement) {
        // Bazaar
        const amountDiv = itemElement.querySelector('div[class*="amount___"], div.amount-main-wrap');
        const priceDiv = itemElement.querySelector('div[class*="price___"], div.price');

        // Item Market
        const imPriceInput = itemElement.querySelector('div[class*="priceInputWrapper___"] input');
        const imAmountInput = itemElement.querySelector('div[class*="amountInputWrapper___"] input');

        // 1. Clear Price Inputs
        if (priceDiv) {
            const priceInputs = priceDiv.querySelectorAll('input');
            priceInputs.forEach(input => {
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }
        if (imPriceInput) {
            imPriceInput.value = '';
            imPriceInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // 2. Clear Quantity or Uncheck
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
        if (imAmountInput) {
            imAmountInput.value = '';
            imAmountInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    function fillItemPrice(itemElement) {
        const image = itemElement.querySelector('img[src*="/items/"]');
        if (!image) return Promise.resolve();

        const itemId = getItemIdFromImage(image);
        if (!itemId) return Promise.resolve();

        const amountDiv = itemElement.querySelector('div[class*="amount___"], div.amount-main-wrap');
        const priceDiv = itemElement.querySelector('div[class*="price___"], div.price');

        const imPriceInput = itemElement.querySelector('div[class*="priceInputWrapper___"] input');
        const imAmountInput = itemElement.querySelector('div[class*="amountInputWrapper___"] input');

        if (!priceDiv && !imPriceInput) return Promise.resolve();

        const isItemMarket = !!imPriceInput;

        return new Promise((resolve) => {
            fetchItemData(itemId, ({ marketValue, sellPrice }) => {
                if (marketValue > 0) {
                    const finalPrice = calculateFinalPrice(marketValue, sellPrice, CONFIG.defaultDiscount, isItemMarket);

                    if (priceDiv) {
                        const priceInputs = priceDiv.querySelectorAll('input');
                        priceInputs.forEach(input => {
                            input.value = finalPrice;
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                        });
                    }

                    if (imPriceInput) {
                        imPriceInput.value = finalPrice;
                        imPriceInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }

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

                    if (imAmountInput) {
                        imAmountInput.value = getQuantity(itemElement);
                        imAmountInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }

                    // UPDATE BUTTON VISUALS FOR UNDO
                    const btn = itemElement.querySelector('.quick-price-btn button');
                    if (btn) {
                        btn.classList.add('qp-btn-red');
                        btn.dataset.mode = 'undo';
                    }
                }
                resolve();
            });
        });
    }

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
        const activeTab = getActiveTab();
        const allItemsLists = document.querySelectorAll('ul.items-cont, div[class*="itemsContainner___"], div[class*="rowItems___"], div[class*="itemList___"]');

        let visibleItems = [];
        for (const list of allItemsLists) {
            const style = window.getComputedStyle(list);
            if (style.display !== 'none') {
                const items = list.querySelectorAll('li.clearfix:not(.disabled), div[class*="item___GYCYJ"], div[class*="item___khvF6"], div[class*="itemRow___"]');
                visibleItems = visibleItems.concat(Array.from(items).filter(item => !item.className.includes('item___UN3Mg')));
            }
        }

        return visibleItems;
    }

    // ===== MANAGE ITEMS PAGE FUNCTIONS =====

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

                // Warn if price change is significant (>20% difference)
                const priceDiff = Math.abs(newPrice - currentPrice);
                const percentDiff = currentPrice > 0 ? (priceDiff / currentPrice) * 100 : 100;

                if (percentDiff > 20 && currentPrice > 0) {
                    const direction = newPrice > currentPrice ? 'increase' : 'decrease';
                    const confirmed = confirm(
                        `Price ${direction} detected!\n\n` +
                        `Current: $${currentPrice.toLocaleString()}\n` +
                        `New: $${newPrice.toLocaleString()}\n` +
                        `Difference: ${percentDiff.toFixed(1)}%\n\n` +
                        `Update to new price?`
                    );
                    if (!confirmed) return;
                }

                // Update the price
                priceInput.value = newPrice;
                priceInput.dispatchEvent(new Event('input', { bubbles: true }));
                priceInput.dispatchEvent(new Event('change', { bubbles: true }));
                // Visual feedback
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

        // Check if button already exists
        if (priceDiv.querySelector('.quick-update-price-btn')) {
            processedManageItems.add(manageItem);
            return;
        }

        processedManageItems.add(manageItem);
        // Find item image to get item ID
        const image = manageItem.querySelector('img');
        if (!image) return;

        const itemId = getItemIdFromImage(image);
        if (!itemId) return;
        // Create update button
        const btnContainer = document.createElement('div');
        btnContainer.className = 'quick-update-price-btn';

        const btnInput = document.createElement('button');
        btnInput.innerHTML = refreshSVG;
        btnInput.className = 'qp-btn qp-btn-update';
        btnInput.setAttribute('title', 'Update Price');
        btnContainer.appendChild(btnInput);

        // Position relative to priceDiv for flex centering
        priceDiv.style.display = 'flex';
        priceDiv.style.alignItems = 'center';
        priceDiv.appendChild(btnContainer);

        btnInput.addEventListener('click', function(event) {
            event.stopPropagation();
            event.preventDefault();
            updateManageItemPrice(priceDiv, itemId);
        });
    }

    function getManageItems() {
        // Look for manage items list
        const manageItemsList = document.querySelectorAll('div[class*="item___"]');
        return Array.from(manageItemsList).filter(item => !item.className.includes('item___UN3Mg'));
    }

    async function updateAllManagePrices() {
        const items = getManageItems();
        console.log('[BazaarQuickPricer] Updating', items.length, 'manage items...');

        if (items.length === 0) {
            alert('No items found to update!');
            return;
        }

        const updateButton = document.getElementById('quickUpdateAllPricesBtn');
        if (updateButton) {
            updateButton.disabled = true;
            updateButton.style.opacity = '0.5';
            updateButton.textContent = 'Updating...';
        }

        let updated = 0;
        for (const item of items) {
            const priceDiv = item.querySelector('div[class*="price"]');
            const image = item.querySelector('img');

            if (priceDiv && image) {
                const itemId = getItemIdFromImage(image);
                if (itemId) {
                    await new Promise((resolve) => {
                        updateManageItemPrice(priceDiv, itemId);
                        setTimeout(resolve, 350);
                    });
                    updated++;
                }
            }
        }

        if (updateButton) {
            updateButton.disabled = false;
            updateButton.style.opacity = '1';
            updateButton.textContent = 'Update All';
        }

        alert(`Updated ${updated} item prices!`);
        console.log('[BazaarQuickPricer] Update complete!');
    }

    function addManagePageButtons() {
        if (manageButtonsAdded) return;
        let attempts = 0;
        const maxAttempts = 20;

        const tryAddButtons = setInterval(() => {
            attempts++;

            // Find header with broader selector support for current Torn UI
            const headings = Array.from(document.querySelectorAll('div[role="heading"], div[class*="title"], div[class*="panelHeader"], div[class*="titleContainer"]'));
            // Look for "Manage your Bazaar" or "Manage items"
            let manageHeading = headings.find(h => h.textContent.includes('Manage your Bazaar') || h.textContent.includes('Manage items') || h.textContent.includes('Manage Bazaar'));

            if (manageHeading) {
                if (document.getElementById('quickUpdateAllPricesBtn')) {
                    clearInterval(tryAddButtons);
                    manageButtonsAdded = true;
                    return;
                }

                clearInterval(tryAddButtons);
                manageButtonsAdded = true;

                // Container for buttons floating right
                const buttonContainer = document.createElement('div');
                buttonContainer.style.cssText = 'float: right; display: flex; gap: 5px; align-items: center; margin-top: -2px;';

                // 1. Update All Button
                const updateAllBtn = document.createElement('button');
                updateAllBtn.id = 'quickUpdateAllPricesBtn';
                updateAllBtn.textContent = 'Update All';
                updateAllBtn.className = 'qp-btn qp-btn-top';
                updateAllBtn.setAttribute('title', 'Update all item prices to current market value');
                updateAllBtn.addEventListener('click', updateAllManagePrices);

                // Only add "Update All" button if NOT on mobile
                if (!isMobile) {
                    buttonContainer.appendChild(updateAllBtn);
                    manageHeading.appendChild(buttonContainer);
                }

                console.log('[BazaarQuickPricer] Manage page buttons added');
            } else if (attempts >= maxAttempts) {
                clearInterval(tryAddButtons);
                console.log('[BazaarQuickPricer] Manage page buttons failed to add (header not found)');
            }
        }, 500);
    }

    function processManageItems() {
        const items = getManageItems();
        console.log('[BazaarQuickPricer] Found', items.length, 'manage items');
        if (items.length > 0) {
            items.forEach(item => addUpdatePriceButton(item));
        }
    }

    // ===== ADD ITEMS PAGE FUNCTIONS =====

    function addQuickPriceButton(itemElement) {
        if (processedItems.has(itemElement)) return;

        // Find the description container that usually contains the name
        const descriptionCont = itemElement.querySelector('div[class*="description___"], div.title-wrap, div[class*="itemInfo___"]');
        if (!descriptionCont) return;

        if (descriptionCont.querySelector('.quick-price-btn')) {
            processedItems.add(itemElement);
            return;
        }

        processedItems.add(itemElement);

        const image = itemElement.querySelector('div.image-wrap img, img[src*="/items/"]');
        if (!image) return;
        const itemId = getItemIdFromImage(image);
        if (!itemId) return;

        const amountDiv = itemElement.querySelector('div.amount-main-wrap');
        const imPriceInput = itemElement.querySelector('div[class*="priceInputWrapper___"] input');

        if (!amountDiv && !imPriceInput) return;

        const btnContainer = document.createElement('div');
        btnContainer.className = 'quick-price-btn';

        const btnInput = document.createElement('button');
        btnInput.innerHTML = addButtonSVG;
        btnInput.className = 'qp-btn';
        btnInput.setAttribute('title', 'Quick Add / Undo');
        btnInput.dataset.mode = 'add'; // Default mode

        btnContainer.appendChild(btnInput);
        descriptionCont.style.display = 'flex';
        descriptionCont.style.alignItems = 'center';
        descriptionCont.appendChild(btnContainer);

        // Click Handler (Toggle Add/Undo)
        btnInput.addEventListener('click', function(event) {
            event.stopPropagation();
            
            if (btnInput.dataset.mode === 'undo') {
                // UNDO ACTION
                clearItemInputs(itemElement);
                // Reset styling
                btnInput.classList.remove('qp-btn-red');
                btnInput.dataset.mode = 'add';
            } else {
                // ADD ACTION
                btnInput.disabled = true;
                btnInput.style.opacity = '0.5';

                fillItemPrice(itemElement).then(() => {
                    btnInput.disabled = false;
                    btnInput.style.opacity = '1';
                });
            }
        });
    }

    async function fillAllItems() {
        const items = getVisibleItems();
        console.log('[BazaarQuickPricer] Filling', items.length, 'items in current tab simultaneously...');

        if (items.length === 0) {
            alert('No items found to fill!');
            return;
        }

        const fillButton = document.getElementById('quickFillAllBtn');
        if (fillButton) {
            fillButton.disabled = true;
            fillButton.style.opacity = '0.5';
            fillButton.textContent = 'Filling...';
        }

        const promises = items.map(item => fillItemPrice(item));
        await Promise.all(promises);
        if (fillButton) {
            fillButton.disabled = false;
            fillButton.style.opacity = '1';
            fillButton.textContent = 'Quick Fill';
        }

        console.log('[BazaarQuickPricer] Fill complete!');
    }

    function addTopButtons() {
        if (buttonsAdded) return;
        let attempts = 0;
        const maxAttempts = 30;

        const tryAddButtons = setInterval(() => {
            attempts++;
            // Broad search for any header-like element that might contain the text
            const potentialHeaders = Array.from(document.querySelectorAll('div[class*="titleContainer___"], div[class*="panelHeader___"], div.title-black, div[class*="title___"], div[class*="listingHeader___"]'));
            const titleSection = potentialHeaders.find(h => h.textContent.includes('Add items to your Bazaar') || h.textContent.includes('Add items') || h.textContent.includes('Add listing') || h.textContent.includes('Add Listing'));

            if (titleSection) {
                if (document.getElementById('quickFillAllBtn')) {
                    clearInterval(tryAddButtons);
                    buttonsAdded = true;
                    return;
                }

                clearInterval(tryAddButtons);
                buttonsAdded = true;

                const buttonContainer = document.createElement('div');
                buttonContainer.style.cssText = 'display:inline-flex;margin-left:15px;vertical-align:top;align-items:flex-start;';

                const fillAllBtn = document.createElement('button');
                fillAllBtn.id = 'quickFillAllBtn';
                fillAllBtn.textContent = 'Quick Fill';
                fillAllBtn.className = 'qp-btn qp-btn-fill';
                fillAllBtn.setAttribute('title', 'Fill all items in current tab with market prices');
                fillAllBtn.addEventListener('click', fillAllItems);

                buttonContainer.appendChild(fillAllBtn);
                titleSection.appendChild(buttonContainer);

                console.log('[BazaarQuickPricer] Buttons added');
            } else if (attempts >= maxAttempts) {
                clearInterval(tryAddButtons);
                console.log('[BazaarQuickPricer] Buttons failed to add');
            }
        }, 500);
    }

    function processAllItems() {
        const items = document.querySelectorAll('ul.items-cont li.clearfix:not(.disabled), div[class*="itemsContainner___"] div[class*="item___"], div[class*="rowItems___"] div[class*="item___"], div[class*="itemRow___"] div[class*="item___"]');
        console.log('[BazaarQuickPricer] Found', items.length, 'items');
        if (items.length > 0) {
            items.forEach(item => {
                if (!item.className.includes('item___UN3Mg')) {
                    addQuickPriceButton(item);
                }
            });
        }
    }

    function setupObserver() {
        const bazaarRoot = document.getElementById('bazaarRoot');
        const marketRoot = document.getElementById('item-market-root');
        const root = bazaarRoot || marketRoot;

        if (!root) {
            setTimeout(setupObserver, 1000);
            return;
        }

        console.log('[BazaarQuickPricer] Observer starting');
        const observer = new MutationObserver(() => {
            clearTimeout(mutationDebounceTimer);
            mutationDebounceTimer = setTimeout(() => {
                processAllItems();
                addTopButtons();
                processManageItems();
                addManagePageButtons();
            }, 300);
        });
        observer.observe(root, { childList: true, subtree: true });
    }

    function init() {
        console.log('[BazaarQuickPricer] Init starting');
        if (!CONFIG.apiKey || CONFIG.apiKey === 'null') {
            setTimeout(showApiKeyPrompt, 1000);
            return;
        }

        createFloatingSettingsButton();

        setTimeout(() => {
            processAllItems();
            setupObserver();
            addTopButtons();
            processManageItems();
            addManagePageButtons();
        }, 2000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 1000);
    }

})();
