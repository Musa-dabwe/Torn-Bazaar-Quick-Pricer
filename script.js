// ==UserScript==
// @name         Torn Bazaar Quick Pricer
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Auto-fill bazaar items with market-based pricing
// @author       Zedtrooper [3028329]
// @license      MIT
// @match        https://www.torn.com/bazaar.php*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @require      https://ajax.googleapis.com/ajax/libs/jquery/3.3.1/jquery.min.js
// @run-at       document-idle
// @downloadURL https://update.greasyfork.org/scripts/558562/Torn%20Bazaar%20Quick%20Pricer.user.js
// @updateURL https://update.greasyfork.org/scripts/558562/Torn%20Bazaar%20Quick%20Pricer.meta.js
// ==/UserScript==

/*
MIT License

Copyright (c) 2024 Zedtrooper [3028329]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        defaultDiscount: GM_getValue('discountPercent', 1),
        priceFloorWarning: GM_getValue('priceFloorPercent', 50),
        apiKey: GM_getValue('tornApiKey', ''),
        lastPriceUpdate: GM_getValue('lastPriceUpdate', 0),
        priceCache: GM_getValue('priceCache', {}),
        cacheTimeout: 5 * 60 * 1000 // 5 minutes
    };

    // Save config
    function saveConfig() {
        GM_setValue('discountPercent', CONFIG.defaultDiscount);
        GM_setValue('priceFloorPercent', CONFIG.priceFloorWarning);
        GM_setValue('tornApiKey', CONFIG.apiKey);
        GM_setValue('lastPriceUpdate', CONFIG.lastPriceUpdate);
        GM_setValue('priceCache', CONFIG.priceCache);
    }

    // API Key prompt
    function showApiKeyPrompt() {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.7);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        overlay.innerHTML = `
            <div style="background: #fff; padding: 30px; border-radius: 10px; max-width: 500px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                <h2 style="margin-top: 0; color: #333;">Bazaar Quick Pricer Setup</h2>
                <p style="color: #666; line-height: 1.6;">
                    This script needs a <strong>Public API Key</strong> to fetch market prices.<br><br>
                    To create one:<br>
                    1. Go to <a href="https://www.torn.com/preferences.php#tab=api" target="_blank" style="color: #2196F3;">Settings → API Key</a><br>
                    2. Create a new <strong>Public</strong> API key<br>
                    3. Copy and paste it below
                </p>
                <input type="text" id="apiKeyInput" placeholder="Enter your API key" style="width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box;">
                <div style="display: flex; gap: 10px; margin-top: 20px;">
                    <button id="saveApiKey" style="flex: 1; padding: 10px; background: #4CAF50; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 14px;">Save</button>
                    <button id="cancelApiKey" style="flex: 1; padding: 10px; background: #f44336; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 14px;">Cancel</button>
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

        document.getElementById('cancelApiKey').onclick = () => {
            overlay.remove();
        };
    }

    // Settings panel
    function showSettingsPanel() {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.7);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        overlay.innerHTML = `
            <div style="background: #fff; padding: 30px; border-radius: 10px; max-width: 500px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                <h2 style="margin-top: 0; color: #333;">Bazaar Quick Pricer Settings</h2>
                
                <div style="margin: 20px 0;">
                    <label style="display: block; margin-bottom: 5px; color: #666; font-weight: bold;">Discount Percentage:</label>
                    <input type="number" id="discountInput" value="${CONFIG.defaultDiscount}" min="0" max="50" step="0.5" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box;">
                    <small style="color: #999;">Price items this % below market average</small>
                </div>

                <div style="margin: 20px 0;">
                    <label style="display: block; margin-bottom: 5px; color: #666; font-weight: bold;">Price Floor Warning (%):</label>
                    <input type="number" id="priceFloorInput" value="${CONFIG.priceFloorWarning}" min="0" max="100" step="5" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box;">
                    <small style="color: #999;">Warn if listing below this % of market value</small>
                </div>

                <div style="margin: 20px 0;">
                    <label style="display: block; margin-bottom: 5px; color: #666; font-weight: bold;">API Key:</label>
                    <input type="text" id="apiKeyUpdateInput" value="${CONFIG.apiKey}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box;">
                </div>

                <div style="margin: 20px 0;">
                    <button id="clearCache" style="width: 100%; padding: 10px; background: #ff9800; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 14px;">Clear Price Cache</button>
                </div>

                <div style="display: flex; gap: 10px; margin-top: 20px;">
                    <button id="saveSettings" style="flex: 1; padding: 10px; background: #4CAF50; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 14px;">Save Settings</button>
                    <button id="cancelSettings" style="flex: 1; padding: 10px; background: #999; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 14px;">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        document.getElementById('clearCache').onclick = () => {
            CONFIG.priceCache = {};
            CONFIG.lastPriceUpdate = 0;
            saveConfig();
            alert('Price cache cleared! Refresh the page.');
        };

        document.getElementById('saveSettings').onclick = () => {
            CONFIG.defaultDiscount = parseFloat(document.getElementById('discountInput').value);
            CONFIG.priceFloorWarning = parseFloat(document.getElementById('priceFloorInput').value);
            CONFIG.apiKey = document.getElementById('apiKeyUpdateInput').value.trim();
            saveConfig();
            overlay.remove();
            alert('Settings saved!');
        };

        document.getElementById('cancelSettings').onclick = () => {
            overlay.remove();
        };
    }

    // Extract item ID from image
    function getItemIdFromImage(image) {
        const numberPattern = /\/(\d+)\//;
        const match = image.src.match(numberPattern);
        if (match) {
            return parseInt(match[1], 10);
        }
        console.error('[BazaarQuickPricer] ItemId not found!');
        return null;
    }

    // Get quantity from item element
    function getQuantity(itemElement) {
        const titleWrap = itemElement.querySelector('div.title-wrap');
        if (!titleWrap) {
            return 1;
        }
        
        const fullText = titleWrap.innerText || titleWrap.textContent;
        const match = fullText.match(/x(\d+)/i);
        if (match) {
            return parseInt(match[1], 10);
        }
        
        return 1;
    }

    // Fetch item data using Torn API to get market_value
    function fetchItemData(itemId, callback) {
        const now = Date.now();
        if (CONFIG.priceCache[itemId] && (now - CONFIG.lastPriceUpdate < CONFIG.cacheTimeout)) {
            callback(CONFIG.priceCache[itemId]);
            return;
        }

        const itemUrl = `https://api.torn.com/torn/${itemId}?selections=items&key=${CONFIG.apiKey}&comment=BazaarQuickPricer`;
        
        GM_xmlhttpRequest({
            method: 'GET',
            url: itemUrl,
            onload: function(response) {
                try {
                    const data = JSON.parse(response.responseText);
                    
                    if (data.error) {
                        console.error(`[BazaarQuickPricer] API Error for item ${itemId}:`, data.error);
                        if (data.error.code === 2) {
                            alert('Incorrect API Key! Please update it in settings.');
                            CONFIG.apiKey = null;
                            saveConfig();
                        }
                        callback(0);
                        return;
                    }

                    if (data.items && data.items[itemId]) {
                        const marketValue = data.items[itemId].market_value;
                        CONFIG.priceCache[itemId] = marketValue;
                        CONFIG.lastPriceUpdate = now;
                        saveConfig();
                        callback(marketValue);
                        return;
                    }
                    
                    callback(0);
                } catch (e) {
                    console.error(`[BazaarQuickPricer] Error parsing data for item ${itemId}:`, e);
                    callback(0);
                }
            },
            onerror: function() {
                console.error(`[BazaarQuickPricer] Failed to fetch data for item ${itemId}`);
                callback(0);
            }
        });
    }

    // Add Quick Price button to an item
    function addQuickPriceButton(itemElement) {
        if (itemElement.querySelector('.quick-price-btn')) return;

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
        btnWrap.style.cssText = 'float: right; margin-left: auto;';

        const btnSpan = document.createElement('span');
        btnSpan.className = 'btn';

        const btnInput = document.createElement('input');
        btnInput.type = 'button';
        btnInput.value = 'Add';
        btnInput.className = 'torn-btn';
        btnInput.style.cssText = 'background: linear-gradient(to bottom, #5cb85c, #4cae4c); color: white; font-size: 11px;';

        btnSpan.appendChild(btnInput);
        btnWrap.appendChild(btnSpan);
        nameWrap.appendChild(btnWrap);

        $(btnWrap).on('click', 'input', function(event) {
            event.stopPropagation();
            
            btnInput.value = 'Loading...';
            btnInput.disabled = true;

            fetchItemData(itemId, (marketValue) => {
                btnInput.disabled = false;
                btnInput.value = 'Add';

                if (marketValue > 0) {
                    const discountAmount = marketValue * (CONFIG.defaultDiscount / 100);
                    const finalPrice = Math.round(marketValue - discountAmount);
                    
                    priceInputs[0].value = finalPrice;
                    priceInputs[1].value = finalPrice;
                    
                    const inputEvent = new Event('input', { bubbles: true });
                    priceInputs[0].dispatchEvent(inputEvent);

                    const isQuantityCheckbox = amountDiv.querySelector('div.amount.choice-container') !== null;
                    if (isQuantityCheckbox) {
                        const checkbox = amountDiv.querySelector('div.amount.choice-container input');
                        if (checkbox && !checkbox.checked) {
                            checkbox.click();
                        }
                    } else {
                        const quantityInput = amountDiv.querySelector('div.amount input');
                        if (quantityInput) {
                            const quantity = getQuantity(itemElement);
                            quantityInput.value = quantity;
                            
                            const keyupEvent = new Event('keyup', { bubbles: true });
                            const changeEvent = new Event('change', { bubbles: true });
                            const inputEvt = new Event('input', { bubbles: true });
                            
                            quantityInput.dispatchEvent(inputEvt);
                            quantityInput.dispatchEvent(keyupEvent);
                            quantityInput.dispatchEvent(changeEvent);
                        }
                    }

                    priceInputs[0].style.border = '2px solid #5cb85c';
                    priceInputs[0].style.background = '#f0fff0';
                    setTimeout(() => {
                        priceInputs[0].style.border = '';
                        priceInputs[0].style.background = '';
                    }, 1500);
                } else {
                    alert(`Could not fetch market value for this item (ID: ${itemId})`);
                }
            });
        });
    }

    // Process all items on the page
    function processAllItems() {
        const items = $('ul.items-cont li.clearfix:not(.disabled)');
        console.log(`[BazaarQuickPricer] Found ${items.length} items to process`);
        
        items.each(function() {
            addQuickPriceButton(this);
        });
    }

    // Set up mutation observer
    function setupObserver() {
        const observerTarget = $('.content-wrapper')[0];
        if (!observerTarget) {
            console.log('[BazaarQuickPricer] Content wrapper not found, retrying...');
            setTimeout(setupObserver, 500);
            return;
        }

        const observer = new MutationObserver(function(mutations) {
            let shouldProcess = false;
            mutations.forEach(mutation => {
                if (mutation.target.classList.contains('items-cont') || 
                    mutation.target.className.indexOf('core-layout___') > -1 ||
                    mutation.target.classList.contains('ReactVirtualized__Grid__innerScrollContainer')) {
                    shouldProcess = true;
                }
            });

            if (shouldProcess) {
                setTimeout(processAllItems, 100);
            }
        });

        observer.observe(observerTarget, { 
            attributes: false, 
            childList: true, 
            characterData: false, 
            subtree: true 
        });

        console.log('[BazaarQuickPricer] Observer set up successfully');
    }

    // Add settings icon to bazaar header
    function addSettingsIcon() {
        const iconsDiv = document.querySelector('h4.title-black + div.icons');
        
        if (iconsDiv) {
            const settingsLink = document.createElement('a');
            settingsLink.href = '#';
            settingsLink.className = 'personalize t-clear h-icon';
            settingsLink.style.cssText = 'margin-left: 5px;';
            
            const iconSpan = document.createElement('span');
            iconSpan.className = 'personalize-icon';
            iconSpan.style.cssText = `
                display: inline-block;
                width: 20px;
                height: 20px;
                background: none;
                font-size: 18px;
                line-height: 20px;
                text-align: center;
            `;
            iconSpan.textContent = '⚙️';
            
            settingsLink.appendChild(iconSpan);
            settingsLink.onclick = (e) => {
                e.preventDefault();
                showSettingsPanel();
            };
            
            iconsDiv.appendChild(settingsLink);
            console.log('[BazaarQuickPricer] Settings icon added to header');
            return true;
        }
        
        return false;
    }

    // Initialize
    function init() {
        if (!CONFIG.apiKey || CONFIG.apiKey === 'null') {
            showApiKeyPrompt();
            return;
        }

        console.log('[BazaarQuickPricer] Initialized');

        setTimeout(() => {
            const success = addSettingsIcon();
            
            if (!success) {
                console.warn('[BazaarQuickPricer] Could not find icons div, using floating button');
                const fallbackBtn = document.createElement('button');
                fallbackBtn.textContent = '⚙️ Settings';
                fallbackBtn.style.cssText = `
                    position: fixed;
                    top: 100px;
                    right: 20px;
                    padding: 10px 15px;
                    background: #2196F3;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                    z-index: 9999;
                    font-size: 14px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
                    font-weight: bold;
                `;
                fallbackBtn.onclick = showSettingsPanel;
                document.body.appendChild(fallbackBtn);
            }
        }, 1500);

        setTimeout(() => {
            processAllItems();
            setupObserver();
        }, 1000);
    }

    if (window.location.href.includes('bazaar.php')) {
        window.addEventListener('load', init);
    }

})();
