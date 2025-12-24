// ==UserScript==
// @name         Torn Bazaar Quick Pricer
// @namespace    http://tampermonkey.net/
// @version      2.6
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
// @downloadURL  https://github.com/Musa-dabwe/Torn-Bazaar-Quick-Pricer/raw/main/torn-bazaar-quick-pricer.user.js
// @updateURL    https://github.com/Musa-dabwe/Torn-Bazaar-Quick-Pricer/raw/main/torn-bazaar-quick-pricer.user.js
// ==/UserScript==

(function() {
    'use strict';

    console.log('[BazaarQuickPricer] v2.6 Starting (PDA optimized)...');

    // Configuration
    const CONFIG = {
        defaultDiscount: GM_getValue('discountPercent', 1),
        apiKey: GM_getValue('tornApiKey', ''),
        lastPriceUpdate: GM_getValue('lastPriceUpdate', 0),
        priceCache: GM_getValue('priceCache', {}),
        cacheTimeout: 5 * 60 * 1000
    };

    const processedItems = new WeakSet();
    let mutationDebounceTimer = null;
    const isMobile = window.innerWidth <= 784;

    // Detect dark mode
    function isDarkMode() {
        return document.body.classList.contains('dark-mode');
    }

    // Get appropriate text color based on theme
    function getTextColor() {
        return isDarkMode() ? '#767676' : '#7F7F7F';
    }

    function saveConfig() {
        GM_setValue('discountPercent', CONFIG.defaultDiscount);
        GM_setValue('tornApiKey', CONFIG.apiKey);
        GM_setValue('lastPriceUpdate', CONFIG.lastPriceUpdate);
        GM_setValue('priceCache', CONFIG.priceCache);
    }

    // Custom SVGs
    const addButtonSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3,7.5v11c0,1.38,1.12,2.5,2.5,2.5h1c.83,0,1.5,.67,1.5,1.5s-.67,1.5-1.5,1.5h-1c-3.03,0-5.5-2.47-5.5-5.5V7.5C0,4.47,2.47,2,5.5,2h.35c.56-1.18,1.76-2,3.15-2h2c1.39,0,2.59,.82,3.15,2h.35c1.96,0,3.78,1.05,4.76,2.75,.42,.72,.17,1.63-.55,2.05-.24,.14-.49,.2-.75,.2-.52,0-1.02-.27-1.3-.75-.45-.77-1.28-1.25-2.17-1.25h-.35c-.56,1.18-1.76,2-3.15,2h-2c-1.39,0-2.59-.82-3.15-2h-.35c-1.38,0-2.5,1.12-2.5,2.5Zm14.5,6.5h-1c-.83,0-1.5,.67-1.5,1.5s.67,1.5,1.5,1.5h1c.83,0,1.5-.67,1.5-1.5s-.67-1.5-1.5-1.5Zm6.5-.5v6c0,2.48-2.02,4.5-4.5,4.5h-5c-2.48,0-4.5-2.02-4.5-4.5v-6c0-2.48,2.02-4.5,4.5-4.5h5c2.48,0,4.5,2.02,4.5,4.5Zm-3,0c0-.83-.67-1.5-1.5-1.5h-5c-.83,0-1.5,.67-1.5,1.5v6c0,.83,.67,1.5,1.5,1.5h5c.83,0,1.5-.67,1.5-1.5v-6Z"/></svg>`;

    const settingsSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="m15.98,7.136c.003.051.02.099.02.151v.714c0,.552.447,1,1,1s1-.448,1-1v-.714c0-1.79-.966-3.453-2.52-4.341l-4-2.286c-1.53-.875-3.432-.875-4.962,0L2.519,2.945C.965,3.833,0,5.497,0,7.287v6.344c0,1.758.939,3.406,2.452,4.302l4,2.369c.771.457,1.652.698,2.548.698.552,0,1-.448,1-1v-9.43l5.98-3.434ZM3.511,4.682l4-2.286c.919-.525,2.059-.524,2.978,0l4,2.286c.276.158.508.365.716.593l-6.221,3.573-6.216-3.536c.214-.243.455-.465.744-.63Zm3.96,13.899l-4-2.369c-.908-.538-1.471-1.526-1.471-2.581v-6.344c0-.035.013-.068.014-.102l5.986,3.406v8.239c-.183-.065-.36-.148-.529-.248Zm15.793.798l-.983-.566c.129-.418.218-.853.218-1.313s-.09-.895-.218-1.313l.983-.566c.479-.275.644-.887.367-1.366-.274-.477-.887-.644-1.365-.367l-.977.563c-.605-.652-1.393-1.126-2.289-1.33v-1.121c0-.552-.447-1-1-1s-1,.448-1,1v1.121c-.896.205-1.685.678-2.289,1.33l-.977-.563c-.479-.277-1.089-.11-1.365.367-.276.479-.112,1.09.367,1.366l.983.566c-.129.418-.218.853-.218,1.313s.09.895.218,1.313l-.983.566c-.479.275-.643.887-.367,1.366.185.321.521.5.867.5.169,0,.341-.043.498-.134l.977-.563c.605.652,1.393,1.126,2.289,1.33v1.121c0,.552.447,1,1,1s1-.448,1-1v-1.121c.896-.205,1.685-.678,2.289-1.33l.977.563c.157.091.329.134.498.134.346,0,.683-.18.867-.5.276-.479.111-1.09-.367-1.366Zm-5.265.621c-1.379,0-2.5-1.122-2.5-2.5s1.121-2.5,2.5-2.5,2.5,1.122,2.5,2.5-1.121,2.5-2.5,2.5Z"/></svg>`;

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

    function showSettingsPanel() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        overlay.innerHTML = `
            <div style="background:#2a2a2a;padding:25px;border-radius:8px;max-width:400px;width:100%;color:#fff;">
                <h2 style="margin:0 0 15px 0;font-size:18px;">Quick Pricer Settings</h2>
                <div style="margin:15px 0;">
                    <label style="display:block;margin-bottom:5px;font-weight:bold;font-size:14px;">Discount %:</label>
                    <input type="number" id="discountInput" value="${CONFIG.defaultDiscount}" min="0" max="50" step="0.5" style="width:100%;padding:10px;border:1px solid #555;border-radius:5px;background:#1a1a1a;color:#fff;font-size:14px;">
                </div>
                <div style="margin:15px 0;">
                    <label style="display:block;margin-bottom:5px;font-weight:bold;font-size:14px;">API Key:</label>
                    <input type="text" id="apiKeyUpdateInput" value="${CONFIG.apiKey}" style="width:100%;padding:10px;border:1px solid #555;border-radius:5px;background:#1a1a1a;color:#fff;font-size:14px;">
                </div>
                <button id="clearCache" style="width:100%;padding:10px;background:#ff9800;color:white;border:none;border-radius:5px;cursor:pointer;font-size:14px;margin:10px 0;">Clear Cache</button>
                <div style="display:flex;gap:10px;margin-top:15px;">
                    <button id="saveSettings" style="flex:1;padding:10px;background:#4CAF50;color:white;border:none;border-radius:5px;cursor:pointer;font-size:14px;">Save</button>
                    <button id="cancelSettings" style="flex:1;padding:10px;background:#999;color:white;border:none;border-radius:5px;cursor:pointer;font-size:14px;">Cancel</button>
                </div>
                <div style="margin-top:15px;padding-top:15px;border-top:1px solid #555;text-align:center;">
                    <small style="color:#999;font-size:12px;">
                        v2.6 | <a href="https://github.com/Musa-dabwe/Torn-Bazaar-Quick-Pricer" target="_blank" style="color:#2196F3;">GitHub</a>
                    </small>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('clearCache').onclick = () => {
            CONFIG.priceCache = {};
            CONFIG.lastPriceUpdate = 0;
            saveConfig();
            alert('Cache cleared!');
        };
        document.getElementById('saveSettings').onclick = () => {
            CONFIG.defaultDiscount = parseFloat(document.getElementById('discountInput').value);
            CONFIG.apiKey = document.getElementById('apiKeyUpdateInput').value.trim();
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
        const titleWrap = itemElement.querySelector('div.title-wrap');
        if (!titleWrap) return 1;
        const match = titleWrap.textContent.match(/x(\d+)/i);
        return match ? parseInt(match[1], 10) : 1;
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
                        callback(0);
                    } else if (data.items?.[itemId]) {
                        const marketValue = data.items[itemId].market_value;
                        CONFIG.priceCache[itemId] = marketValue;
                        CONFIG.lastPriceUpdate = Date.now();
                        saveConfig();
                        callback(marketValue);
                    } else {
                        callback(0);
                    }
                } catch (e) {
                    callback(0);
                }
                isProcessingQueue = false;
                setTimeout(processRequestQueue, 300);
            },
            onerror: function() {
                callback(0);
                isProcessingQueue = false;
                setTimeout(processRequestQueue, 300);
            }
        });
    }

    function fetchItemData(itemId, callback) {
        const now = Date.now();
        if (CONFIG.priceCache[itemId] && (now - CONFIG.lastPriceUpdate < CONFIG.cacheTimeout)) {
            callback(CONFIG.priceCache[itemId]);
            return;
        }
        requestQueue.push({ itemId, callback });
        processRequestQueue();
    }

    function addQuickPriceButton(itemElement) {
        if (processedItems.has(itemElement)) return;
        processedItems.add(itemElement);

        const nameWrap = itemElement.querySelector('div.title-wrap div.name-wrap');
        if (!nameWrap) return;

        const image = itemElement.querySelector('div.image-wrap img');
        if (!image) return;

        const itemId = getItemIdFromImage(image);
        if (!itemId) return;

        const amountDiv = itemElement.querySelector('div.amount-main-wrap');
        if (!amountDiv) return;

        const priceInputs = amountDiv.querySelectorAll('div.price div input');
        if (priceInputs.length === 0) return;

        const btnWrap = document.createElement('span');
        btnWrap.className = 'btn-wrap quick-price-btn';
        btnWrap.style.cssText = 'float:right;margin-left:5px;';

        const btnSpan = document.createElement('span');
        btnSpan.className = 'btn';

        const btnInput = document.createElement('button');
        btnInput.innerHTML = addButtonSVG;
        btnInput.style.cssText = 'background:linear-gradient(to bottom,#5cb85c,#4cae4c);color:white;padding:6px 10px;border:none;border-radius:3px;cursor:pointer;display:flex;align-items:center;justify-content:center;';
        btnInput.setAttribute('title', 'Quick Add');

        btnSpan.appendChild(btnInput);
        btnWrap.appendChild(btnSpan);
        nameWrap.appendChild(btnWrap);

        btnInput.addEventListener('click', function(event) {
            event.stopPropagation();
            btnInput.disabled = true;
            btnInput.style.opacity = '0.5';

            fetchItemData(itemId, (marketValue) => {
                btnInput.disabled = false;
                btnInput.style.opacity = '1';

                if (marketValue > 0) {
                    const finalPrice = Math.round(marketValue * (1 - CONFIG.defaultDiscount / 100));
                    priceInputs[0].value = finalPrice;
                    priceInputs[1].value = finalPrice;
                    priceInputs[0].dispatchEvent(new Event('input', { bubbles: true }));

                    const isQuantityCheckbox = amountDiv.querySelector('div.amount.choice-container');
                    if (isQuantityCheckbox) {
                        const checkbox = isQuantityCheckbox.querySelector('input');
                        if (checkbox && !checkbox.checked) checkbox.click();
                    } else {
                        const quantityInput = amountDiv.querySelector('div.amount input');
                        if (quantityInput) {
                            quantityInput.value = getQuantity(itemElement);
                            quantityInput.dispatchEvent(new Event('input', { bubbles: true }));
                            quantityInput.dispatchEvent(new Event('keyup', { bubbles: true }));
                        }
                    }
                    priceInputs[0].style.border = '2px solid #5cb85c';
                    setTimeout(() => priceInputs[0].style.border = '', 1000);
                } else {
                    alert('Could not fetch price');
                }
            });
        });
    }

    function processAllItems() {
        const items = document.querySelectorAll('ul.items-cont li.clearfix:not(.disabled)');
        console.log('[BazaarQuickPricer] Found', items.length, 'items');
        if (items.length > 0) {
            items.forEach(item => addQuickPriceButton(item));
        }
    }

    function setupObserver() {
        const bazaarRoot = document.getElementById('bazaarRoot');
        if (!bazaarRoot) {
            setTimeout(setupObserver, 1000);
            return;
        }

        console.log('[BazaarQuickPricer] Observer starting');
        const observer = new MutationObserver(() => {
            clearTimeout(mutationDebounceTimer);
            mutationDebounceTimer = setTimeout(processAllItems, 300);
        });

        observer.observe(bazaarRoot, { childList: true, subtree: true });
    }

    function addSettingsIcon() {
        let attempts = 0;
        const maxAttempts = 20;
        
        const tryAddIcon = setInterval(() => {
            attempts++;
            const iconsContainer = document.querySelector('div[class*="linksContainer"]');
            
            if (iconsContainer) {
                clearInterval(tryAddIcon);
                
                const textColor = getTextColor();
                
                const settingsBtn = document.createElement('button');
                settingsBtn.style.cssText = 'background:none;border:none;padding:5px;cursor:pointer;display:flex;align-items:center;gap:5px;';
                
                const iconWrapper = document.createElement('span');
                iconWrapper.innerHTML = settingsSVG.replace('fill="currentColor"', `fill="${textColor}"`);
                iconWrapper.style.color = textColor;
                
                const textLabel = document.createElement('span');
                textLabel.textContent = 'Settings';
                textLabel.style.cssText = `color:${textColor};font-size:13px;${isMobile ? 'display:none;' : ''}`;
                
                settingsBtn.appendChild(iconWrapper);
                settingsBtn.appendChild(textLabel);
                settingsBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    showSettingsPanel();
                });
                
                iconsContainer.insertBefore(settingsBtn, iconsContainer.firstChild);
                console.log('[BazaarQuickPricer] Settings added with color:', textColor);
            } else if (attempts >= maxAttempts) {
                clearInterval(tryAddIcon);
                console.log('[BazaarQuickPricer] Settings icon failed');
            }
        }, 500);
    }

    function init() {
        console.log('[BazaarQuickPricer] Init starting');
        
        if (!CONFIG.apiKey || CONFIG.apiKey === 'null') {
            setTimeout(showApiKeyPrompt, 1000);
            return;
        }

        setTimeout(() => {
            processAllItems();
            setupObserver();
            addSettingsIcon();
        }, 2000);
    }

    // Start after page loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 1000);
    }

})();
