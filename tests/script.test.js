import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadScript } from './load-script.js';

const testDir = dirname(fileURLToPath(import.meta.url));

describe('Material icon map', () => {
    const { QP } = loadScript();
    const requiredIcons = [
        'info', 'refresh', 'settings', 'key', 'visibility',
        'visibility_off', 'add', 'undo', 'check_circle', 'error', 'warning',
        'sports_martial_arts', 'open_in_new', 'close'
    ];

    it.each(requiredIcons)('maps %s to a normalized, parseable SVG with path data', name => {
        const icon = QP.getMaterialIcon(name);
        expect(icon).toEqual(expect.any(String));
        expect(icon).toContain('viewBox="0 0 24 24"');
        expect(icon).toContain('fill="currentColor"');
        expect(icon).toContain('aria-hidden="true"');

        const container = document.createElement('div');
        container.innerHTML = icon;
        const svg = container.querySelector('svg');
        expect(svg).toBeTruthy();
        const vectorData = svg.querySelector('path[d], polygon[points], circle[r]');
        expect(vectorData).toBeTruthy();
        expect(vectorData.getAttribute('d') || vectorData.getAttribute('points') || vectorData.getAttribute('r')).toBeTruthy();
    });

    it.each(requiredIcons)('embeds the reviewed path data for %s', name => {
        const sourcePath = resolve(testDir, `../docs/assets/material-icons/${name}.svg`);
        const source = readFileSync(sourcePath, 'utf8');
        const sourceContainer = document.createElement('div');
        sourceContainer.innerHTML = source;
        const mappedContainer = document.createElement('div');
        mappedContainer.innerHTML = QP.getMaterialIcon(name);

        expect(mappedContainer.querySelector('svg').innerHTML)
            .toBe(sourceContainer.querySelector('svg').innerHTML);
    });

    it('exposes every required semantic name in the centralized map', () => {
        expect(Object.keys(QP.MATERIAL_ICONS).sort()).toEqual([...requiredIcons].sort());
    });

    it('keeps distinct source assets distinct', () => {
        const renderedIcons = requiredIcons.map(name => QP.getMaterialIcon(name));
        expect(new Set(renderedIcons).size).toBe(requiredIcons.length);
    });

    it.each(['not_a_material_icon', 'toString', 'constructor', '__proto__'])(
        'returns null for the unsafe or unknown name %s', name => {
            expect(QP.getMaterialIcon(name)).toBe(null);
        }
    );

    it('sizes every inline icon context and colors header badges violet', () => {
        const css = document.getElementById('qp-style').textContent;
        ['.qp-item-btn svg', '.qp-bubble svg', '.qp-head__badge svg', '.qp-eye-toggle svg', '.qp-toast__icon svg']
            .forEach(selector => expect(css).toContain(`${selector} {`));
        expect(css).toMatch(/\.qp-head__badge\s*\{[^}]*color:\s*var\(--qp-accent\)/);
    });

    // No .qp-btn renders an icon any more (Clear cache is text-only), so the
    // button-icon sizing rule would be dead styling. Pinned as absent so a
    // future icon-in-button change has to add the rule back deliberately.
    it('keeps the dead .qp-btn svg sizing rule out of the stylesheet', () => {
        expect(document.getElementById('qp-style').textContent).not.toContain('.qp-btn svg');
    });

    it('wires mapped icons into status, confirmation, close, overflow, and undo UI paths', () => {
        const script = readFileSync(resolve(testDir, '../torn-bazaar-quick-pricer.user.js'), 'utf8');
        ['check_circle', 'error', 'info', 'warning', 'sports_martial_arts', 'undo', 'open_in_new', 'close']
            .forEach(name => {
                const uses = script.match(new RegExp(`getMaterialIcon\\('${name}'\\)`, 'g')) || [];
                expect(uses.length).toBeGreaterThanOrEqual(1);
            });
    });

    // inventory_2 lost its only consumer when Clear cache became text-only, and
    // more_vert was never used by the final bubble design. Neither should linger
    // in the map, in the script, or in the provenance assets.
    it.each(['inventory_2', 'more_vert'])('drops the unused %s icon, its usage, and its source asset', name => {
        expect(QP.getMaterialIcon(name)).toBe(null);
        expect(Object.keys(QP.MATERIAL_ICONS)).not.toContain(name);

        const script = readFileSync(resolve(testDir, '../torn-bazaar-quick-pricer.user.js'), 'utf8');
        expect(script).not.toContain(`getMaterialIcon('${name}')`);

        const sourcePath = resolve(testDir, `../docs/assets/material-icons/${name}.svg`);
        expect(() => readFileSync(sourcePath)).toThrow();
        expect(readFileSync(resolve(testDir, '../docs/assets/material-icons/README.md'), 'utf8'))
            .not.toContain(`${name}.svg`);
    });
});

describe('smoke', () => {
    it('loads without throwing and injects its stylesheet', () => {
        const { QP } = loadScript();
        expect(QP).toBeTruthy();
        expect(document.getElementById('qp-style')).toBeTruthy();
    });

    it('sweeps a previous instance\'s style on re-load', () => {
        loadScript();
        loadScript();
        expect(document.querySelectorAll('#qp-style').length).toBe(1);
    });
});

describe('PDA initialization and dialog focus', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        window.location.hash = '';
    });

    function trackObservers() {
        const observers = [];
        const OriginalMutationObserver = globalThis.MutationObserver;
        class TrackedMutationObserver {
            constructor(callback) {
                this.callback = callback;
                this.disconnect = vi.fn();
                this.observe = vi.fn();
                observers.push(this);
            }
        }
        globalThis.MutationObserver = TrackedMutationObserver;
        return { observers, restore: () => { globalThis.MutationObserver = OriginalMutationObserver; } };
    }

    it('checks for an existing bazaar root immediately', () => {
        const root = document.createElement('div');
        root.id = 'bazaarRoot';
        document.body.appendChild(root);
        const { QP } = loadScript({ tornApiKey: 'abcDEF1234567890' });

        QP.init();

        expect(document.querySelector('#bazaarRoot')).toBe(root);
        expect(document.querySelector('.qp-bubble')).toBeTruthy();
    });

    it('does not duplicate fallback paths when DOMContentLoaded follows the initial failed check', () => {
        vi.useFakeTimers();
        const originalReadyState = document.readyState;
        Object.defineProperty(document, 'readyState', { configurable: true, value: 'loading' });
        const tracked = trackObservers();
        try {
            const { QP } = loadScript();

            QP.init();
            expect(tracked.observers).toHaveLength(1);
            expect(vi.getTimerCount()).toBe(2);

            document.dispatchEvent(new window.Event('DOMContentLoaded'));

            expect(tracked.observers).toHaveLength(1);
            expect(vi.getTimerCount()).toBe(2);
        } finally {
            Object.defineProperty(document, 'readyState', { configurable: true, value: originalReadyState });
            tracked.restore();
            vi.advanceTimersByTime(20000);
            vi.useRealTimers();
        }
    });

    it('cleans up and initializes once when MutationObserver discovers the root', () => {
        vi.useFakeTimers();
        const tracked = trackObservers();
        try {
            const { QP } = loadScript({ tornApiKey: 'abcDEF1234567890' });
            QP.init();
            const waitObserver = tracked.observers[0];
            const root = document.createElement('div');
            root.id = 'bazaarRoot';
            document.body.appendChild(root);

            waitObserver.callback();
            vi.advanceTimersByTime(5000);

            expect(waitObserver.disconnect).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
            expect(tracked.observers).toHaveLength(2);
            expect(tracked.observers[1].observe).toHaveBeenCalledTimes(1);
            expect(tracked.observers[1].observe).toHaveBeenCalledWith(root, { childList: true, subtree: true });
            expect(document.querySelectorAll('.qp-bubble')).toHaveLength(1);
        } finally {
            tracked.restore();
            vi.useRealTimers();
        }
    });

    it('cleans up and initializes once when polling discovers the root', () => {
        vi.useFakeTimers();
        const tracked = trackObservers();
        try {
            const { QP } = loadScript({ tornApiKey: 'abcDEF1234567890' });
            QP.init();
            const waitObserver = tracked.observers[0];
            const root = document.createElement('div');
            root.id = 'bazaarRoot';
            document.body.appendChild(root);

            vi.advanceTimersByTime(100);
            vi.advanceTimersByTime(5000);

            expect(waitObserver.disconnect).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
            expect(tracked.observers).toHaveLength(2);
            expect(tracked.observers[1].observe).toHaveBeenCalledTimes(1);
            expect(tracked.observers[1].observe).toHaveBeenCalledWith(root, { childList: true, subtree: true });
            expect(document.querySelectorAll('.qp-bubble')).toHaveLength(1);
        } finally {
            tracked.restore();
            vi.useRealTimers();
        }
    });

    it('bounds observer and polling cleanup to the root-search timeout', () => {
        vi.useFakeTimers();
        const tracked = trackObservers();
        try {
            const { QP } = loadScript();
            QP.init();
            const waitObserver = tracked.observers[0];

            vi.advanceTimersByTime(20000);

            expect(waitObserver.disconnect).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            tracked.restore();
            vi.useRealTimers();
        }
    });

    it('does not focus the API input when the key prompt opens', () => {
        const previous = document.activeElement;
        const { QP } = loadScript();

        QP.showApiKeyPrompt();

        const input = document.querySelector('#qpApiKey');
        expect(input).toBeTruthy();
        expect(document.activeElement).toBe(previous);
        expect(document.activeElement).not.toBe(input);
    });
});

describe('isValidApiKey', () => {
    const { QP } = loadScript();
    it('accepts exactly 16 alphanumeric characters', () => {
        expect(QP.isValidApiKey('abcDEF1234567890')).toBe(true);
    });
    it('rejects wrong lengths', () => {
        expect(QP.isValidApiKey('abcDEF123456789')).toBe(false);
        expect(QP.isValidApiKey('abcDEF12345678901')).toBe(false);
        expect(QP.isValidApiKey('')).toBe(false);
    });
    it('rejects non-alphanumeric characters and non-strings', () => {
        expect(QP.isValidApiKey('abcDEF12345678-0')).toBe(false);
        expect(QP.isValidApiKey('###PDA-APIKEY##x')).toBe(false);
        expect(QP.isValidApiKey(null)).toBe(false);
        expect(QP.isValidApiKey(1234567890123456)).toBe(false);
    });
});

describe('clampDiscount', () => {
    const { QP } = loadScript();
    it('passes through sane values', () => {
        expect(QP.clampDiscount(12.5)).toBe(12.5);
        expect(QP.clampDiscount(0)).toBe(0);
    });
    it('clamps out-of-range values', () => {
        expect(QP.clampDiscount(-50)).toBe(0);
        expect(QP.clampDiscount(150)).toBe(99.9);
    });
    it('treats garbage as 0', () => {
        expect(QP.clampDiscount('abc')).toBe(0);
        expect(QP.clampDiscount(undefined)).toBe(0);
        expect(QP.clampDiscount(NaN)).toBe(0);
    });
});

describe('clampThreshold', () => {
    const { QP } = loadScript();
    it('passes through sane values', () => {
        expect(QP.clampThreshold(35)).toBe(35);
        expect(QP.clampThreshold(0)).toBe(0);
    });
    it('clamps out-of-range values', () => {
        expect(QP.clampThreshold(-5)).toBe(0);
        expect(QP.clampThreshold(5000)).toBe(1000);
    });
    it('treats garbage as the default 20', () => {
        expect(QP.clampThreshold('abc')).toBe(20);
        expect(QP.clampThreshold(undefined)).toBe(20);
    });
});

describe('calculateFinalPrice', () => {
    it('applies the discount to the market value', () => {
        const { QP } = loadScript();
        expect(QP.calculateFinalPrice(1000, 0, 10)).toBe(900);
        expect(QP.calculateFinalPrice(1000, 0, 0)).toBe(1000);
    });

    it('floors at the NPC sell price by default', () => {
        const { QP } = loadScript();
        expect(QP.calculateFinalPrice(1000, 950, 10)).toBe(950);
    });

    it('skips the NPC floor when disabled', () => {
        const { QP } = loadScript({ disableNpcCheck: true });
        expect(QP.calculateFinalPrice(1000, 950, 10)).toBe(900);
    });

    it('never produces a negative price, even with an absurd stored discount', () => {
        const { QP } = loadScript({ disableNpcCheck: true });
        expect(QP.calculateFinalPrice(1000, 0, 150)).toBeGreaterThanOrEqual(0);
        expect(QP.calculateFinalPrice(1000, 0, -50)).toBe(1000);
    });

    it('prices above market when priceBelowMarket is off (markup)', () => {
        const { QP } = loadScript({ priceBelowMarket: false });
        expect(QP.calculateFinalPrice(1000, 0, 10)).toBe(1100);
        expect(QP.calculateFinalPrice(1000, 0, 0)).toBe(1000);
    });

    it('applies the 99.9% ceiling to markups too', () => {
        const { QP } = loadScript({ priceBelowMarket: false });
        expect(QP.calculateFinalPrice(1000, 0, 150)).toBe(1999);
    });

    it('never floors a markup at the NPC sell price', () => {
        const { QP } = loadScript({ priceBelowMarket: false });
        expect(QP.calculateFinalPrice(1000, 950, 10)).toBe(1100);
    });
});

describe('getItemIdFromImage', () => {
    const { QP } = loadScript();
    it('extracts the item id from a Torn image URL', () => {
        expect(QP.getItemIdFromImage({ src: 'https://www.torn.com/images/items/206/large.png' })).toBe(206);
    });
    it('returns null when no id is present', () => {
        expect(QP.getItemIdFromImage({ src: 'https://www.torn.com/images/blank.png' })).toBe(null);
    });
});

describe('getQuantity', () => {
    const { QP } = loadScript();

    function itemWithTitle(text) {
        const el = document.createElement('div');
        const title = document.createElement('div');
        title.className = 'title-wrap';
        title.textContent = text;
        el.appendChild(title);
        return el;
    }

    it('reads a trailing quantity marker', () => {
        expect(QP.getQuantity(itemWithTitle('Xanax x25'))).toBe(25);
    });
    it('defaults to 1 without a marker', () => {
        expect(QP.getQuantity(itemWithTitle('Xanax'))).toBe(1);
    });
    it('ignores x<digits> embedded mid-name', () => {
        expect(QP.getQuantity(itemWithTitle('Model x15 Rifle'))).toBe(1);
    });
    it('defaults to 1 when the title element is missing', () => {
        expect(QP.getQuantity(document.createElement('div'))).toBe(1);
    });
});

describe('getItemName', () => {
    const { QP } = loadScript();

    function itemWithTitle(text) {
        const el = document.createElement('div');
        const title = document.createElement('div');
        title.className = 'title-wrap';
        title.textContent = text;
        el.appendChild(title);
        return el;
    }

    it('strips a trailing quantity marker', () => {
        expect(QP.getItemName(itemWithTitle('Xanax x25'))).toBe('Xanax');
    });
    it('keeps names without a marker intact', () => {
        expect(QP.getItemName(itemWithTitle('Model x15 Rifle'))).toBe('Model x15 Rifle');
    });
    it('returns null when the title element is missing', () => {
        expect(QP.getItemName(document.createElement('div'))).toBe(null);
    });
});

describe('RW weapon detection', () => {
    const { QP } = loadScript();

    function rwItem({ bonus, glow }) {
        const el = document.createElement('div');
        el.innerHTML = `
            <div class="title-wrap"><div class="image-wrap ${glow || ''}"></div></div>
            <ul class="bonuses-wrap"><li class="bonus left"><i class="${bonus}"></i></li></ul>
        `;
        return el;
    }

    it('detects a known RW bonus with rarity', () => {
        const info = QP.getRWBonusInfo(rwItem({ bonus: 'bonus-attachment-bleed', glow: 'glow-yellow' }));
        expect(info).toEqual({ isRanked: true, bonus: 'bleed', rarity: 'yellow' });
    });
    it('ignores unknown bonuses', () => {
        const info = QP.getRWBonusInfo(rwItem({ bonus: 'bonus-attachment-notabonus' }));
        expect(info.isRanked).toBe(false);
    });
    it('ignores blank bonus placeholders', () => {
        const info = QP.getRWBonusInfo(rwItem({ bonus: 'bonus-attachment-blank-bonus' }));
        expect(info.isRanked).toBe(false);
    });
    it('reports items without bonus markup as not ranked', () => {
        expect(QP.getRWBonusInfo(document.createElement('div')).isRanked).toBe(false);
    });
});

describe('rwSkipLabel', () => {
    const { QP } = loadScript();
    it('capitalizes rarity and bonus', () => {
        expect(QP.rwSkipLabel({ rarity: 'yellow', bonus: 'bleed' })).toBe('Yellow Bleed RW weapon');
    });
    it('handles missing fields', () => {
        expect(QP.rwSkipLabel({ rarity: null, bonus: null })).toBe('Unknown rarity Unknown bonus RW weapon');
    });
});

describe('settings storage', () => {
    it('writes settings through to GM storage', () => {
        const { QP, storage } = loadScript();
        QP.CONFIG.defaultDiscount = 7.5;
        expect(storage.discountPercent).toBe(7.5);
        expect(QP.CONFIG.defaultDiscount).toBe(7.5);
    });

    it('exposes only format-valid API keys', () => {
        const { QP } = loadScript({ tornApiKey: 'not-a-valid-key!' });
        expect(QP.CONFIG.apiKey).toBe('');
        const good = loadScript({ tornApiKey: 'abcDEF1234567890' });
        expect(good.QP.CONFIG.apiKey).toBe('abcDEF1234567890');
    });

    it('defaults to skipping $1 items and a 20% alert threshold', () => {
        const { QP } = loadScript();
        expect(QP.CONFIG.skipDollarItems).toBe(true);
        expect(QP.CONFIG.priceDiffThreshold).toBe(20);
    });

    it('defaults to pricing below market and round-trips the flag', () => {
        const { QP, storage } = loadScript();
        expect(QP.CONFIG.priceBelowMarket).toBe(true);
        QP.CONFIG.priceBelowMarket = false;
        expect(storage.priceBelowMarket).toBe(false);
        expect(QP.CONFIG.priceBelowMarket).toBe(false);
    });

    it('clamps a garbage stored alert threshold on read', () => {
        const { QP } = loadScript({ priceDiffThreshold: 99999 });
        expect(QP.CONFIG.priceDiffThreshold).toBe(1000);
    });

    it('derives cacheTimeout from the minutes setting with a floor of 1', () => {
        const { QP } = loadScript({ cacheTimeoutMin: 10 });
        expect(QP.CONFIG.cacheTimeout).toBe(10 * 60 * 1000);
        const floored = loadScript({ cacheTimeoutMin: 0 });
        expect(floored.QP.CONFIG.cacheTimeout).toBe(60 * 1000);
    });
});

describe('API v2 adapters', () => {
    const { QP } = loadScript();

    it('uses a batch size of 10 and builds a v2 item URL', () => {
        expect(QP.V2_BATCH_SIZE).toBe(10);
        expect(QP.buildV2ItemsUrl([206, 207], 'abcDEF1234567890'))
            .toBe('https://api.torn.com/v2/torn/206,207/items?key=abcDEF1234567890');
    });

    it('parses a valid item response into normalized values', () => {
        const result = QP.parseV2ItemsResponse({
            items: [{ id: 206, value: { market_price: 830000, sell_price: 750000 } }]
        }, [206]);
        expect(result.values[206]).toEqual({ marketValue: 830000, sellPrice: 750000 });
        expect(result.parsedIds).toEqual([206]);
    });

    it('normalizes a null sell price to zero', () => {
        const result = QP.parseV2ItemsResponse({
            items: [{ id: 206, value: { market_price: 830000, sell_price: null } }]
        }, [206]);
        expect(result.values[206]).toEqual({ marketValue: 830000, sellPrice: 0 });
    });

    it('parses an item with a zero market price', () => {
        const result = QP.parseV2ItemsResponse({
            items: [{ id: 206, value: { market_price: 0, sell_price: 750000 } }]
        }, [206]);
        expect(result.values[206]).toEqual({ marketValue: 0, sellPrice: 750000 });
        expect(result.parsedIds).toEqual([206]);
    });

    it.each([
        { value: { market_price: 830000 }, case: 'missing sell_price' },
        { value: { market_price: 830000, sell_price: '750000' }, case: 'nonnumeric sell_price' },
        { value: { sell_price: 750000 }, case: 'missing market_price' }
    ])('does not parse an item with an invalid schema: $case', ({ value }) => {
        const result = QP.parseV2ItemsResponse({
            items: [{ id: 206, value }]
        }, [206]);
        expect(result.values).toEqual({});
        expect(result.parsedIds).toEqual([]);
    });

    it.each([0, 750000])('preserves numeric sell_price %i', sellPrice => {
        const result = QP.parseV2ItemsResponse({
            items: [{ id: 206, value: { market_price: 830000, sell_price: sellPrice } }]
        }, [206]);
        expect(result.values[206]).toEqual({ marketValue: 830000, sellPrice });
    });
});

describe('API v2 request queue integration', () => {
    const apiKey = 'abcDEF1234567890';

    function setup() {
        const requests = [];
        const { QP } = loadScript({ tornApiKey: apiKey }, options => requests.push(options));
        return { QP, requests };
    }

    async function startQueue() {
        await vi.advanceTimersByTimeAsync(0);
    }

    it('batches synchronous fetches and resolves both callbacks', async () => {
        vi.useFakeTimers();
        try {
            const { QP, requests } = setup();
            const results = [];
            QP.fetchItemData(206, result => results.push([206, result]));
            QP.fetchItemData(207, result => results.push([207, result]));
            await startQueue();

            expect(requests).toHaveLength(1);
            expect(requests[0].url).toBe(`https://api.torn.com/v2/torn/206,207/items?key=${apiKey}`);
            requests[0].onload({ responseText: JSON.stringify({ items: [
                { id: 206, value: { market_price: 100, sell_price: 90 } },
                { id: 207, value: { market_price: 200, sell_price: 180 } }
            ] }) });
            await startQueue();
            expect(results).toEqual([
                [206, { marketValue: 100, sellPrice: 90 }],
                [207, { marketValue: 200, sellPrice: 180 }]
            ]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('isolates callback errors and resolves every callback exactly once', async () => {
        vi.useFakeTimers();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const { QP, requests } = setup();
            const second = vi.fn();
            QP.fetchItemData(206, () => { throw new Error('first callback failed'); });
            QP.fetchItemData(206, second);
            await startQueue();

            requests[0].onload({ responseText: JSON.stringify({ items: [
                { id: 206, value: { market_price: 100, sell_price: 90 } }
            ] }) });
            await vi.advanceTimersByTimeAsync(600);

            expect(second).toHaveBeenCalledTimes(1);
            expect(second).toHaveBeenCalledWith({ marketValue: 100, sellPrice: 90 });
            expect(requests).toHaveLength(1);
            expect(consoleError).toHaveBeenCalledWith(
                '[BazaarQuickPricer] Price callback error for item 206:',
                expect.any(Error)
            );
            expect(consoleError).not.toHaveBeenCalledWith(
                '[BazaarQuickPricer] Parse error:',
                expect.anything()
            );
        } finally {
            consoleError.mockRestore();
            vi.useRealTimers();
        }
    });

    it('splits 11 uncached IDs into a 10-ID batch and a 1-ID remainder', async () => {
        vi.useFakeTimers();
        try {
            const { QP, requests } = setup();
            const itemIds = Array.from({ length: 11 }, (_, i) => i + 1);
            const results = [];
            itemIds.forEach(itemId => QP.fetchItemData(itemId, result => results.push([itemId, result])));
            await startQueue();

            expect(requests).toHaveLength(1);
            expect(requests[0].url).toBe(
                `https://api.torn.com/v2/torn/${itemIds.slice(0, 10).join(',')}/items?key=${apiKey}`
            );
            requests[0].onload({ responseText: JSON.stringify({ items: itemIds.slice(0, 10).map(id => ({
                id,
                value: { market_price: id * 10, sell_price: id * 9 }
            })) }) });
            await vi.advanceTimersByTimeAsync(600);

            expect(requests).toHaveLength(2);
            expect(requests[1].url).toBe(
                `https://api.torn.com/v2/torn/${itemIds[10]}/items?key=${apiKey}`
            );
            requests[1].onload({ responseText: JSON.stringify({ items: [
                { id: 11, value: { market_price: 110, sell_price: 99 } }
            ] }) });
            await startQueue();

            expect(results).toHaveLength(11);
            expect(results.at(-1)).toEqual([11, { marketValue: 110, sellPrice: 99 }]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('makes no request when all requested prices are fresh in cache', async () => {
        const requests = [];
        const freshCache = {
            206: { marketValue: 100, sellPrice: 90, timestamp: Date.now() }
        };
        const { QP } = loadScript({ tornApiKey: apiKey, priceCache: freshCache }, options => requests.push(options));
        const result = vi.fn();

        QP.fetchItemData(206, result);

        expect(requests).toHaveLength(0);
        expect(result).toHaveBeenCalledTimes(1);
        expect(result).toHaveBeenCalledWith({ marketValue: 100, sellPrice: 90 });
    });

    it('reuses values cached by a v2 batch', async () => {
        vi.useFakeTimers();
        try {
            const { QP, requests } = setup();
            const first = vi.fn();
            QP.fetchItemData(206, first);
            await startQueue();
            requests[0].onload({ responseText: JSON.stringify({ items: [
                { id: 206, value: { market_price: 100, sell_price: 90 } }
            ] }) });
            await startQueue();
            QP.fetchItemData(206, first);
            expect(first).toHaveBeenCalledTimes(2);
            expect(requests).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('zero-fails only malformed items in a mixed response', async () => {
        vi.useFakeTimers();
        try {
            const { QP, requests } = setup();
            const results = [];
            QP.fetchItemData(206, result => results.push([206, result]));
            QP.fetchItemData(207, result => results.push([207, result]));
            await startQueue();
            requests[0].onload({ responseText: JSON.stringify({ items: [
                { id: 206, value: { market_price: 100, sell_price: 90 } },
                { id: 207, value: { sell_price: 180 } }
            ] }) });
            await startQueue();
            expect(results).toEqual([
                [206, { marketValue: 100, sellPrice: 90 }],
                [207, { marketValue: 0, sellPrice: 0 }]
            ]);
            expect(requests).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('falls back to v1 for every item in a malformed v2 batch', async () => {
        vi.useFakeTimers();
        try {
            const { QP, requests } = setup();
            const results = [];
            const first = vi.fn();
            const second = vi.fn();
            QP.fetchItemData(206, result => { first(result); results.push([206, result]); });
            QP.fetchItemData(207, result => { second(result); results.push([207, result]); });
            await startQueue();
            requests[0].onload({ responseText: JSON.stringify({ items: [{ id: 206 }, { id: 207 }] }) });
            await vi.advanceTimersByTimeAsync(600);
            expect(requests).toHaveLength(2);
            expect(requests[1].url).toBe(`https://api.torn.com/torn/206?selections=items&key=${apiKey}`);
            requests[1].onload({ responseText: JSON.stringify({ items: { 206: { market_value: 11, sell_price: 10 } } }) });
            await vi.advanceTimersByTimeAsync(600);
            expect(requests).toHaveLength(3);
            expect(requests[2].url).toBe(`https://api.torn.com/torn/207?selections=items&key=${apiKey}`);
            requests[2].onload({ responseText: JSON.stringify({ items: { 207: { market_value: 22, sell_price: 20 } } }) });
            await startQueue();
            expect(results).toEqual([
                [206, { marketValue: 11, sellPrice: 10 }],
                [207, { marketValue: 22, sellPrice: 20 }]
            ]);
            expect(first).toHaveBeenCalledTimes(1);
            expect(second).toHaveBeenCalledTimes(1);
            expect(QP.getCachedPrice(206)).toEqual({ marketValue: 11, sellPrice: 10, timestamp: expect.any(Number) });
            expect(QP.getCachedPrice(207)).toEqual({ marketValue: 22, sellPrice: 20, timestamp: expect.any(Number) });
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not start a new request before the 600 ms spacing window ends', async () => {
        vi.useFakeTimers();
        try {
            const { QP, requests } = setup();
            QP.fetchItemData(206, vi.fn());
            await startQueue();
            requests[0].onload({ responseText: JSON.stringify({ items: [
                { id: 206, value: { market_price: 100, sell_price: 90 } }
            ] }) });
            QP.fetchItemData(207, vi.fn());
            await startQueue();
            expect(requests).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(599);
            expect(requests).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(requests).toHaveLength(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('retries code 5 twice, then falls back to v1 once', async () => {
        vi.useFakeTimers();
        try {
            const { QP, requests } = setup();
            const result = vi.fn();
            QP.fetchItemData(206, result);
            await startQueue();
            for (let attempt = 0; attempt < 3; attempt++) {
                requests[attempt].onload({ responseText: JSON.stringify({ error: { code: 5, error: 'rate limited' } }) });
                if (attempt < 2) {
                    await vi.advanceTimersByTimeAsync(5000);
                    expect(requests).toHaveLength(attempt + 2);
                }
            }
            await vi.advanceTimersByTimeAsync(600);
            expect(requests).toHaveLength(4);
            expect(requests[3].url).toBe(`https://api.torn.com/torn/206?selections=items&key=${apiKey}`);
            requests[3].onload({ responseText: JSON.stringify({ items: { 206: { market_value: 42, sell_price: 40 } } }) });
            await startQueue();
            expect(result).toHaveBeenCalledTimes(1);
            expect(result).toHaveBeenCalledWith({ marketValue: 42, sellPrice: 40 });
        } finally {
            vi.useRealTimers();
        }
    });

    it.each(['onerror', 'ontimeout', 'onabort'])('falls back once on v2 %s', async eventName => {
        vi.useFakeTimers();
        try {
            const { QP, requests } = setup();
            const result = vi.fn();
            QP.fetchItemData(206, result);
            await startQueue();
            requests[0][eventName]();
            requests[0][eventName]();
            await vi.advanceTimersByTimeAsync(600);
            expect(requests).toHaveLength(2);
            expect(requests[1].url).toBe(`https://api.torn.com/torn/206?selections=items&key=${apiKey}`);
            expect(result).not.toHaveBeenCalled();
            requests[1].onload({ responseText: JSON.stringify({ items: { 206: { market_value: 42, sell_price: 40 } } }) });
            await startQueue();
            expect(result).toHaveBeenCalledTimes(1);
            expect(result).toHaveBeenCalledWith({ marketValue: 42, sellPrice: 40 });
        } finally {
            vi.useRealTimers();
        }
    });

    it.each([
        [2, 'bad key'],
        [8, 'IP blocked'],
        [9, 'API disabled']
    ])('does not fall back to v1 after fatal v2 API error %i', async (code, message) => {
        vi.useFakeTimers();
        try {
            const { QP, requests } = setup();
            const result = vi.fn();
            QP.fetchItemData(206, result);
            await startQueue();
            requests[0].onload({ responseText: JSON.stringify({ error: { code, error: message } }) });
            await startQueue();
            expect(requests).toHaveLength(1);
            expect(result).toHaveBeenCalledWith({ marketValue: 0, sellPrice: 0 });
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps a 10-item v2 URL below the length limit', () => {
        const { QP } = loadScript();
        expect(QP.buildV2ItemsUrl(Array.from({ length: 10 }, (_, i) => i + 1), apiKey).length).toBeLessThan(2000);
    });
});

function pointer(target, type, { x = 20, y = 30, pointerId = 1 } = {}) {
    const event = new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    target.dispatchEvent(event);
}

function iconHtml(QP, name) {
    const container = document.createElement('div');
    container.innerHTML = QP.getMaterialIcon(name);
    return container.innerHTML;
}

/**
 * Mount an add-items row with a price input plus either a quantity text input or
 * a quantity checkbox, matching the real Torn markup the selectors key off.
 */
function addQuantityRow({ price = '', quantity = '', checked = false, checkbox = false } = {}) {
    const list = document.querySelector('ul.items-cont') || (() => {
        const created = document.createElement('ul');
        created.className = 'items-cont';
        document.body.appendChild(created);
        return created;
    })();
    const item = document.createElement('li');
    item.className = 'clearfix';
    const amount = document.createElement('div');
    amount.className = 'amount-main-wrap';
    let quantityControl;
    if (checkbox) {
        const wrap = document.createElement('div');
        wrap.className = 'choice-container';
        quantityControl = document.createElement('input');
        quantityControl.type = 'checkbox';
        quantityControl.checked = checked;
        wrap.appendChild(quantityControl);
        amount.appendChild(wrap);
    } else {
        quantityControl = document.createElement('input');
        quantityControl.value = quantity;
        amount.appendChild(quantityControl);
    }
    const priceWrap = document.createElement('div');
    priceWrap.className = 'price';
    const priceInput = document.createElement('input');
    priceInput.value = price;
    priceWrap.appendChild(priceInput);
    item.append(amount, priceWrap);
    list.appendChild(item);
    return { item, priceInput, quantityControl };
}

/**
 * Mount the floating bubble against a fresh script instance. Defaults to an
 * already-seen changelog version so unrelated bubble tests are not interrupted
 * by the first-Add changelog gate.
 */
function mountBubble(storage = {}, requestHandler = () => {}) {
    const { QP, storage: loadedStorage } = loadScript(
        { changelogSeenVersion: '2.9.4', ...storage },
        requestHandler
    );
    const bubble = QP.createFloatingBubble();
    bubble.setPointerCapture = vi.fn();
    bubble.getBoundingClientRect = () => ({
        left: 10, top: 20, right: 62, bottom: 72, width: 52, height: 52
    });
    return { QP, bubble, storage: loadedStorage };
}

describe('route-aware circular bubble', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        window.location.hash = '';
        vi.restoreAllMocks();
    });

    const makeBubble = mountBubble;

    function addItem(price) {
        const list = document.createElement('ul');
        list.className = 'items-cont';
        const item = document.createElement('li');
        item.className = 'clearfix';
        const priceWrap = document.createElement('div');
        priceWrap.className = 'price';
        const input = document.createElement('input');
        input.value = price;
        priceWrap.appendChild(input);
        item.appendChild(priceWrap);
        list.appendChild(item);
        document.body.appendChild(list);
        return item;
    }

    it.each([
        ['', 'unsupported'],
        ['#/', 'unsupported'],
        ['#/add', 'add'],
        ['#/manage', 'manage'],
        ['#/personalize', 'unsupported'],
        ['#/unknown', 'unsupported']
    ])('maps route %j to %s', (hash, route) => {
        const { QP } = loadScript();
        expect(QP.getBubbleRoute(hash)).toBe(route);
    });

    it('hides the bubble on every unsupported route and renders Fill/refresh on Add/Manage', () => {
        const { QP, bubble } = makeBubble();
        expect(bubble.classList.contains('qp-bubble-hidden')).toBe(true);

        window.location.hash = '#/add';
        window.dispatchEvent(new window.HashChangeEvent('hashchange'));
        expect(bubble.classList.contains('qp-bubble-hidden')).toBe(false);
        expect(bubble.textContent).toBe('Fill');
        expect(bubble.querySelector('svg')).toBeNull();

        window.location.hash = '#/manage';
        window.dispatchEvent(new window.HashChangeEvent('hashchange'));
        expect(bubble.classList.contains('qp-bubble-hidden')).toBe(false);
        expect(bubble.innerHTML).toBe(iconHtml(QP, 'refresh'));

        window.location.hash = '#/personalize';
        window.dispatchEvent(new window.HashChangeEvent('hashchange'));
        expect(bubble.classList.contains('qp-bubble-hidden')).toBe(true);

        window.location.hash = '#/add';
        window.dispatchEvent(new window.HashChangeEvent('hashchange'));
        expect(bubble.classList.contains('qp-bubble-hidden')).toBe(false);
        expect(bubble.textContent).toBe('Fill');
    });

    it('re-renders the bubble on real input events without a request or scroll', () => {
        const root = document.createElement('div');
        root.id = 'bazaarRoot';
        document.body.appendChild(root);
        window.location.hash = '#/add';
        const { priceInput } = addQuantityRow({ quantity: '2' });
        root.append(...document.querySelectorAll('.items-cont'));
        const requests = [];
        const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
        const { QP, bubble } = makeBubble({}, options => requests.push(options));
        QP.setupObserver(root);
        const input = document.querySelector('.price input');
        expect(root.contains(input)).toBe(true);
        input.value = '';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));

        expect(bubble.textContent).toBe('Fill');
        expect(requests).toHaveLength(0);
        expect(scrollTo).not.toHaveBeenCalled();
        expect(priceInput.value).toBe('');
    });

    it('announces the current action through the bubble accessible label', () => {
        window.location.hash = '#/add';
        const { QP, bubble } = makeBubble();
        expect(bubble.getAttribute('aria-label')).toBe('Quick Fill');

        QP.setBubbleMode('clear');
        expect(bubble.getAttribute('aria-label')).toBe('Clear quantities');

        QP.setBubbleMode('fill');
        expect(bubble.getAttribute('aria-label')).toBe('Quick Fill');
    });

    it('keeps the Manage label distinct from the Add states', () => {
        window.location.hash = '#/manage';
        const { bubble } = makeBubble();
        expect(bubble.getAttribute('aria-label')).toBe('Update all prices');
    });

    it('resets the Add mode to fill when the route changes', () => {
        window.location.hash = '#/add';
        const { QP, bubble } = makeBubble();
        QP.setBubbleMode('clear');
        expect(QP.getBubbleMode()).toBe('clear');

        window.location.hash = '#/manage';
        window.dispatchEvent(new window.HashChangeEvent('hashchange'));
        expect(QP.getBubbleMode()).toBe('fill');

        QP.setBubbleMode('clear');
        window.location.hash = '#/personalize';
        window.dispatchEvent(new window.HashChangeEvent('hashchange'));
        window.location.hash = '#/add';
        window.dispatchEvent(new window.HashChangeEvent('hashchange'));

        expect(QP.getBubbleMode()).toBe('fill');
        expect(QP.isBubbleActionClear()).toBe(false);
        expect(bubble.textContent).toBe('Fill');
    });

    it('returns from an unsupported route to Add and re-renders the bubble', () => {
        window.location.hash = '#/personalize';
        const { bubble } = makeBubble();
        expect(bubble.classList.contains('qp-bubble-hidden')).toBe(true);

        window.location.hash = '#/add';
        window.dispatchEvent(new window.HashChangeEvent('hashchange'));
        expect(bubble.classList.contains('qp-bubble-hidden')).toBe(false);
        expect(bubble.textContent).toBe('Fill');
    });

    it('clamps restored and resized positions to the viewport', () => {
        const previousWidth = window.innerWidth;
        const previousHeight = window.innerHeight;
        const { bubble } = makeBubble({ chipPosition: { x: 1000, y: 1000 } });
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 80 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 70 });
        window.dispatchEvent(new window.Event('resize'));

        expect(bubble.style.left).toBe('22px');
        expect(bubble.style.top).toBe('12px');
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: previousHeight });
    });
    it('opens settings after the 350 ms long press and does not tap afterward', () => {
        vi.useFakeTimers();
        try {
            window.location.hash = '#/add';
            const { bubble } = makeBubble();
            pointer(bubble, 'pointerdown');
            vi.advanceTimersByTime(349);
            expect(document.querySelector('.qp-overlay')).toBeNull();
            vi.advanceTimersByTime(1);
            expect(document.querySelector('.qp-head__title')?.textContent).toBe('Quick Pricer settings');
            pointer(bubble, 'pointerup');
            expect(document.querySelectorAll('.qp-overlay')).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('renders the settings icon while dragging and restores the route state on release', () => {
        vi.useFakeTimers();
        try {
            window.location.hash = '#/add';
            const { QP, bubble } = makeBubble();
            pointer(bubble, 'pointerdown');
            pointer(bubble, 'pointermove', { x: 27, y: 30 });
            expect(bubble.classList.contains('qp-bubble-dragging')).toBe(true);
            expect(bubble.innerHTML).toBe(iconHtml(QP, 'settings'));
            vi.advanceTimersByTime(350);
            pointer(bubble, 'pointerup');

            expect(document.querySelector('.qp-overlay')).toBeNull();
            expect(bubble.classList.contains('qp-bubble-dragging')).toBe(false);
            expect(bubble.textContent).toBe('Fill');
            expect(bubble.style.left).toBe('17px');
            expect(bubble.style.top).toBe('20px');
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the bubble hidden on an unsupported route even while dragging', () => {
        vi.useFakeTimers();
        try {
            window.location.hash = '#/personalize';
            const { QP, bubble } = makeBubble();
            expect(bubble.classList.contains('qp-bubble-hidden')).toBe(true);

            pointer(bubble, 'pointerdown', { pointerId: 21 });
            pointer(bubble, 'pointermove', { pointerId: 21, x: 40, y: 30 });

            // The drag icon is transient, but it must never un-hide the bubble on
            // a route that has no bubble at all.
            expect(bubble.classList.contains('qp-bubble-hidden')).toBe(true);
            pointer(bubble, 'pointerup', { pointerId: 21 });
            expect(bubble.classList.contains('qp-bubble-hidden')).toBe(true);
            expect(bubble.className).not.toContain('qp-bubble-dragging');
            QP.renderBubbleContent();
            expect(bubble.classList.contains('qp-bubble-hidden')).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('restores the route state when a drag is cancelled', () => {
        vi.useFakeTimers();
        try {
            window.location.hash = '#/add';
            const { QP, bubble } = makeBubble();
            pointer(bubble, 'pointerdown');
            pointer(bubble, 'pointermove', { x: 40, y: 30 });
            expect(bubble.innerHTML).toBe(iconHtml(QP, 'settings'));
            pointer(bubble, 'pointercancel');
            expect(bubble.classList.contains('qp-bubble-dragging')).toBe(false);
            expect(bubble.textContent).toBe('Fill');
        } finally {
            vi.useRealTimers();
        }
    });

    it.each([
        ['#/add', 'No items found to fill!'],
        ['#/manage', 'No items found to update!']
    ])('runs the %s batch action through the bubble tap path', (hash, expectedToast) => {
        window.location.hash = hash;
        const { bubble } = makeBubble({ tornApiKey: 'abcDEF1234567890' });
        pointer(bubble, 'pointerdown', { pointerId: 7 });
        pointer(bubble, 'pointerup', { pointerId: 7 });

        expect(document.querySelector('.qp-toast-error')?.textContent).toContain(expectedToast);
    });

    it('performs no action on an unsupported-route bubble tap', () => {
        const { bubble } = makeBubble();
        expect(bubble.classList.contains('qp-bubble-hidden')).toBe(true);
        pointer(bubble, 'pointerdown');
        pointer(bubble, 'pointerup');

        expect(document.querySelector('.qp-overlay')).toBeNull();
        expect(document.querySelector('.qp-toast')).toBeNull();
        expect(bubble.classList.contains('qp-bubble-hidden')).toBe(true);
    });

    it('stays hidden and performs no action on a Personalize bubble tap', () => {
        window.location.hash = '#/personalize';
        const { bubble } = makeBubble();
        expect(bubble.classList.contains('qp-bubble-hidden')).toBe(true);
        pointer(bubble, 'pointerdown');
        pointer(bubble, 'pointerup');

        expect(document.querySelector('.qp-overlay')).toBeNull();
        expect(bubble.classList.contains('qp-bubble-hidden')).toBe(true);
    });

    it('ignores secondary pointer events without replacing or ending the active gesture', () => {
        vi.useFakeTimers();
        try {
            const { bubble } = makeBubble();
            pointer(bubble, 'pointerdown', { pointerId: 1, x: 20, y: 30 });
            pointer(bubble, 'pointerdown', { pointerId: 2, x: 80, y: 90 });
            expect(bubble.setPointerCapture).toHaveBeenCalledTimes(1);
            pointer(bubble, 'pointermove', { pointerId: 2, x: 100, y: 110 });
            expect(bubble.style.left).toBe('10px');
            expect(bubble.style.top).toBe('20px');
            pointer(bubble, 'pointerup', { pointerId: 2, x: 100, y: 110 });
            vi.advanceTimersByTime(350);

            expect(document.querySelector('.qp-head__title')?.textContent).toBe('Quick Pricer settings');
            pointer(bubble, 'pointerup', { pointerId: 1, x: 20, y: 30 });
            expect(document.querySelectorAll('.qp-overlay')).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('cancels before drag threshold and allows a later tap without long press', () => {
        vi.useFakeTimers();
        try {
            window.location.hash = '#/add';
            const { bubble } = makeBubble({ tornApiKey: 'abcDEF1234567890' });
            pointer(bubble, 'pointerdown', { pointerId: 4 });
            pointer(bubble, 'pointercancel', { pointerId: 4 });
            vi.advanceTimersByTime(350);
            expect(document.querySelector('.qp-overlay')).toBeNull();

            // The cancelled gesture must not be replayed as a long press, and the
            // later tap is a plain Add tap rather than a stale drag or tap.
            pointer(bubble, 'pointerdown', { pointerId: 5 });
            pointer(bubble, 'pointerup', { pointerId: 5 });
            expect(document.querySelectorAll('.qp-overlay')).toHaveLength(0);
            expect(document.querySelector('.qp-toast-error')?.textContent).toContain('No items found to fill!');
        } finally {
            vi.useRealTimers();
        }
    });

    it('cancels after drag threshold and allows a later tap without drag or long press', () => {
        vi.useFakeTimers();
        try {
            window.location.hash = '#/add';
            const { bubble } = makeBubble({ tornApiKey: 'abcDEF1234567890' });
            pointer(bubble, 'pointerdown', { pointerId: 6 });
            pointer(bubble, 'pointermove', { pointerId: 6, x: 30 });
            expect(bubble.classList.contains('qp-bubble-dragging')).toBe(true);
            pointer(bubble, 'pointercancel', { pointerId: 6 });
            expect(bubble.classList.contains('qp-bubble-dragging')).toBe(false);
            vi.advanceTimersByTime(350);
            expect(document.querySelector('.qp-overlay')).toBeNull();

            // A later tap is a plain Add tap, which has no items to fill here.
            pointer(bubble, 'pointerdown', { pointerId: 8 });
            pointer(bubble, 'pointerup', { pointerId: 8 });
            expect(document.querySelector('.qp-toast-error')?.textContent).toContain('No items found to fill!');
        } finally {
            vi.useRealTimers();
        }
    });

    it('moves the bubble by 10 px with each arrow key and persists the position', () => {
        const { bubble, storage } = makeBubble();
        bubble.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        expect(bubble.style.left).toBe('20px');
        expect(bubble.style.top).toBe('20px');
        expect(storage.chipPosition).toEqual({ x: 20, y: 20 });
    });

    it.each(['Enter', ' '])('activates %s exactly once', key => {
        window.location.hash = '#/add';
        const { bubble } = makeBubble({ tornApiKey: 'abcDEF1234567890' });
        bubble.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        bubble.dispatchEvent(new window.KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));

        expect(document.querySelectorAll('.qp-overlay')).toHaveLength(0);
        expect(document.querySelectorAll('.qp-toast')).toHaveLength(1);
        expect(document.querySelector('.qp-toast')?.textContent).toContain('No items found to fill!');
    });

    it('opens and closes the local v2.9.4 changelog by button, scrim, and Escape', () => {
        const { QP } = loadScript();
        const expectedNotes = [
            /API v2 batches/i,
            /circular Material 3 bubble/i,
            /route-aware actions/i,
            /PDA initialization/i,
            /v1 fallback and rate-limit safeguards/i
        ];

        for (const close of [
            overlay => overlay.querySelector('#qpChangelogClose').click(),
            overlay => overlay.click(),
            overlay => overlay.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        ]) {
            QP.showChangelog();
            const overlay = document.querySelector('.qp-overlay');
            expect(overlay).toBeTruthy();
            expect(overlay.textContent).toContain('2.9.4');
            expectedNotes.forEach(note => expect(overlay.textContent).toMatch(note));
            expect(overlay.querySelector('[role="dialog"]')).toBeTruthy();
            close(overlay);
            expect(document.querySelector('.qp-overlay')).toBeNull();
        }
    });

    it('does not focus an API-key input when opening settings or changelog dialogs', () => {
        const { QP } = loadScript();
        QP.showSettingsPanel();
        expect(document.activeElement).not.toBe(document.querySelector('#qpApiKey'));
        document.querySelector('.qp-overlay').remove();

        QP.showChangelog();
        expect(document.activeElement).not.toBe(document.querySelector('#qpApiKey'));
    });

    it('shows batch progress and switches the Add bubble to the close icon after completion', async () => {
        vi.useFakeTimers();
        try {
            const requests = [];
            window.location.hash = '#/add';
            const { QP, bubble } = makeBubble(
                { tornApiKey: 'abcDEF1234567890' },
                options => requests.push(options)
            );
            const item = addItem('');
            const imageWrap = document.createElement('div');
            imageWrap.className = 'image-wrap';
            const image = document.createElement('img');
            image.src = 'https://www.torn.com/images/items/206/large.png';
            imageWrap.appendChild(image);
            const title = document.createElement('div');
            title.className = 'title-wrap';
            title.appendChild(imageWrap);
            const amount = document.createElement('div');
            amount.className = 'amount-main-wrap';
            amount.appendChild(document.createElement('input'));
            item.prepend(amount, title);
            const run = QP.fillAllItems();
            await vi.advanceTimersByTimeAsync(0);
            expect(requests).toHaveLength(1);
            expect(bubble.textContent).toBe('0%');
            requests[0].onload({ responseText: JSON.stringify({ items: [
                { id: 206, value: { market_price: 100, sell_price: 90 } }
            ] }) });
            await run;

            expect(bubble.textContent).toBe('');
            expect(bubble.querySelector('.qp-bubble-progress')).toBeNull();
            expect(bubble.querySelector('svg')).toBeTruthy();
            expect(QP.getBubbleMode()).toBe('clear');
            expect(QP.isBubbleActionClear()).toBe(true);
            expect(bubble.innerHTML).toBe(iconHtml(QP, 'close'));
            expect(bubble.getAttribute('aria-label')).toBe('Clear quantities');
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('first-Add changelog gate', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        window.location.hash = '';
        vi.restoreAllMocks();
    });

    it('reports unseen until the current version is marked', () => {
        const fresh = loadScript();
        expect(fresh.QP.shouldShowChangelogForVersion()).toBe(true);
        fresh.QP.markChangelogSeen();
        expect(fresh.storage.changelogSeenVersion).toBe('2.9.4');
        expect(fresh.QP.shouldShowChangelogForVersion()).toBe(false);

        const upgraded = loadScript({ changelogSeenVersion: '2.9.3' });
        expect(upgraded.QP.shouldShowChangelogForVersion()).toBe(true);
    });

    it('opens the changelog once on the first Add visit and never again for that version', () => {
        window.location.hash = '#/add';
        const { QP, bubble, storage } = mountBubble({ changelogSeenVersion: '2.9.3' });

        window.dispatchEvent(new window.HashChangeEvent('hashchange'));
        expect(document.querySelectorAll('.qp-overlay')).toHaveLength(1);
        expect(document.querySelector('.qp-head__title')?.textContent).toBe("What's new");

        document.querySelector('#qpChangelogClose').click();
        expect(storage.changelogSeenVersion).toBe('2.9.4');
        expect(document.querySelectorAll('.qp-overlay')).toHaveLength(0);

        QP.updateBubbleState();
        QP.renderBubbleContent();
        expect(document.querySelectorAll('.qp-overlay')).toHaveLength(0);
        expect(storage.changelogSeenVersion).toBe('2.9.4');
        expect(bubble.textContent).toBe('Fill');
    });

    it('never opens the changelog on the base or Personalize route', () => {
        const { QP, bubble, storage } = mountBubble({ changelogSeenVersion: '2.9.3' });
        QP.updateBubbleState();
        window.dispatchEvent(new window.HashChangeEvent('hashchange'));
        expect(document.querySelectorAll('.qp-overlay')).toHaveLength(0);
        expect(storage.changelogSeenVersion).toBe('2.9.3');
        expect(bubble.classList.contains('qp-bubble-hidden')).toBe(true);

        window.location.hash = '#/personalize';
        window.dispatchEvent(new window.HashChangeEvent('hashchange'));
        expect(document.querySelectorAll('.qp-overlay')).toHaveLength(0);
        expect(storage.changelogSeenVersion).toBe('2.9.3');
        expect(bubble.classList.contains('qp-bubble-hidden')).toBe(true);
    });

    it('refuses to stack a second changelog overlay', () => {
        const { QP } = loadScript();
        QP.showChangelog();
        QP.showChangelog();
        expect(document.querySelectorAll('.qp-overlay')).toHaveLength(1);
    });

    it('marks the version seen when closed by scrim or Escape', () => {
        for (const close of [
            overlay => overlay.click(),
            overlay => overlay.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        ]) {
            const { QP, storage } = loadScript();
            QP.showChangelog();
            close(document.querySelector('.qp-overlay'));
            expect(storage.changelogSeenVersion).toBe('2.9.4');
        }
    });

    it.each(['', '#/', '#/personalize'])(
        'does not open or mark the changelog when the prompt closes on route %j',
        route => {
            const root = document.createElement('div');
            root.id = 'bazaarRoot';
            document.body.appendChild(root);
            window.location.hash = route;
            const { QP, storage } = loadScript({ changelogSeenVersion: '2.9.3' });

            QP.init();
            expect(document.querySelector('#qpApiKey')).toBeTruthy();

            document.querySelector('#qpCancel').click();
            expect(document.querySelectorAll('.qp-overlay')).toHaveLength(0);
            // Critically: the version must stay un-seen so the changelog can still
            // appear when the user actually visits Add.
            expect(storage.changelogSeenVersion).toBe('2.9.3');

            window.location.hash = '#/add';
            window.dispatchEvent(new window.HashChangeEvent('hashchange'));
            expect(document.querySelector('.qp-head__title')?.textContent).toBe("What's new");
        }
    );

    it('runs the gate after the API-key prompt closes, without stacking overlays', () => {
        const root = document.createElement('div');
        root.id = 'bazaarRoot';
        document.body.appendChild(root);
        window.location.hash = '#/add';
        const { QP, storage } = loadScript({ changelogSeenVersion: '2.9.3' });

        QP.init();
        expect(document.querySelectorAll('.qp-overlay')).toHaveLength(1);
        expect(document.querySelector('#qpApiKey')).toBeTruthy();

        // A route change while the prompt is open must not stack the changelog.
        window.dispatchEvent(new window.HashChangeEvent('hashchange'));
        expect(document.querySelectorAll('.qp-overlay')).toHaveLength(1);
        expect(document.querySelector('.qp-head__title')?.textContent).toBe('Quick Pricer');

        document.querySelector('#qpCancel').click();
        expect(document.querySelector('#qpApiKey')).toBeNull();
        expect(document.querySelectorAll('.qp-overlay')).toHaveLength(1);
        expect(document.querySelector('.qp-head__title')?.textContent).toBe("What's new");

        document.querySelector('#qpChangelogClose').click();
        expect(storage.changelogSeenVersion).toBe('2.9.4');
    });
});

describe('price cache', () => {
    it('serves fresh entries and rejects stale ones', () => {
        const { QP } = loadScript();
        QP.cachePrice(206, 830000, 750000);
        const hit = QP.getCachedPrice(206);
        expect(hit.marketValue).toBe(830000);
        expect(hit.sellPrice).toBe(750000);
        expect(QP.getCachedPrice(999)).toBe(null);
    });

    it('prunes stale entries from persisted storage at startup', () => {
        const stale = { 206: { marketValue: 1, sellPrice: 1, timestamp: Date.now() - 60 * 60 * 1000 } };
        const { QP, storage } = loadScript({ priceCache: stale });
        expect(QP.getCachedPrice(206)).toBe(null);
        expect(storage.priceCache[206]).toBeUndefined();
    });

    it('clearPriceCache empties memory and storage immediately', () => {
        const { QP, storage } = loadScript();
        QP.cachePrice(206, 100, 50);
        QP.clearPriceCache();
        expect(QP.getCachedPrice(206)).toBe(null);
        expect(storage.priceCache).toEqual({});
    });
});

describe('clearAllQuantities', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        window.location.hash = '#/add';
        vi.restoreAllMocks();
    });

    it('clears numeric quantity inputs, keeps prices, and reports the count', () => {
        const requests = [];
        const { QP } = mountBubble({ tornApiKey: 'abcDEF1234567890' }, options => requests.push(options));
        addQuantityRow({ price: '1,250', quantity: '25' });
        const second = addQuantityRow({ price: '90', quantity: '3' });

        expect(QP.clearAllQuantities()).toBe(2);
        expect(document.querySelectorAll('.amount-main-wrap input')).toHaveLength(2);
        document.querySelectorAll('.amount-main-wrap input').forEach(input => {
            expect(input.value).toBe('');
        });
        expect(document.querySelectorAll('.price input')[0].value).toBe('1,250');
        expect(second.priceInput.value).toBe('90');
        expect(requests).toHaveLength(0);
        expect(document.querySelector('.qp-toast')?.textContent).toContain('Cleared quantities on 2 items');
    });

    it('unchecks quantity checkboxes and leaves unchecked rows alone', () => {
        const requests = [];
        const { QP } = mountBubble({ tornApiKey: 'abcDEF1234567890' }, options => requests.push(options));
        const checked = addQuantityRow({ price: '500', checkbox: true, checked: true });
        const unchecked = addQuantityRow({ price: '600', checkbox: true, checked: false });

        expect(QP.clearAllQuantities()).toBe(1);
        expect(checked.quantityControl.checked).toBe(false);
        expect(unchecked.quantityControl.checked).toBe(false);
        expect(checked.priceInput.value).toBe('500');
        expect(unchecked.priceInput.value).toBe('600');
        expect(requests).toHaveLength(0);
        expect(document.querySelector('.qp-toast')?.textContent).toContain('Cleared quantities on 1 item');
    });

    it('ignores empty rows and reports nothing to clear', () => {
        const { QP } = mountBubble({ tornApiKey: 'abcDEF1234567890' });
        addQuantityRow({ price: '', quantity: '' });
        addQuantityRow({ price: '10', checkbox: true, checked: false });

        expect(QP.clearAllQuantities()).toBe(0);
        expect(document.querySelectorAll('.price input')[1].value).toBe('10');
        expect(document.querySelector('.qp-toast')?.textContent).toContain('No quantities to clear');
    });

    it('never mis-targets a checkbox on a row that also has a numeric quantity', () => {
        const { QP } = mountBubble({ tornApiKey: 'abcDEF1234567890' });
        const row = addQuantityRow({ price: '20', quantity: '4' });
        // A checkbox that the quantity-checkbox selector does not match must not
        // be treated as the numeric quantity input.
        const strayCheckbox = document.createElement('input');
        strayCheckbox.type = 'checkbox';
        strayCheckbox.checked = true;
        row.item.querySelector('.amount-main-wrap').prepend(strayCheckbox);

        expect(QP.clearAllQuantities()).toBe(1);
        expect(strayCheckbox.checked).toBe(true);
        expect(row.quantityControl.value).toBe('');
    });

    it('only touches currently loaded rows', () => {
        const { QP } = mountBubble({ tornApiKey: 'abcDEF1234567890' });
        const loaded = addQuantityRow({ price: '10', quantity: '2' });
        const hiddenList = document.createElement('ul');
        hiddenList.className = 'items-cont';
        hiddenList.style.display = 'none';
        const hiddenItem = document.createElement('li');
        hiddenItem.className = 'clearfix';
        const hiddenAmount = document.createElement('div');
        hiddenAmount.className = 'amount-main-wrap';
        const hiddenQuantity = document.createElement('input');
        hiddenQuantity.value = '9';
        hiddenAmount.appendChild(hiddenQuantity);
        hiddenItem.appendChild(hiddenAmount);
        hiddenList.appendChild(hiddenItem);
        document.body.appendChild(hiddenList);

        expect(QP.clearAllQuantities()).toBe(1);
        expect(loaded.quantityControl.value).toBe('');
        expect(hiddenQuantity.value).toBe('9');
    });

    it('resets the bubble to the Fill label after clearing', () => {
        const { QP, bubble } = mountBubble({ tornApiKey: 'abcDEF1234567890' });
        addQuantityRow({ price: '10', quantity: '2' });
        QP.setBubbleMode('clear');
        expect(QP.getBubbleMode()).toBe('clear');
        expect(QP.isBubbleActionClear()).toBe(true);
        expect(bubble.innerHTML).toBe(iconHtml(QP, 'close'));

        QP.clearAllQuantities();

        expect(QP.getBubbleMode()).toBe('fill');
        expect(QP.isBubbleActionClear()).toBe(false);
        expect(bubble.textContent).toBe('Fill');
    });

    it('falls back to the fill mode for an unknown mode value', () => {
        const { QP } = mountBubble();
        QP.setBubbleMode('clear');
        QP.setBubbleMode('nonsense');
        expect(QP.getBubbleMode()).toBe('fill');
    });
});

describe('Fill and clear bubble actions', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        window.location.hash = '#/add';
        vi.restoreAllMocks();
    });

    /** An add-items row that Quick Fill can price: image, title, quantity, price. */
    function addFillableItem() {
        const row = addQuantityRow({ price: '', quantity: '' });
        const title = document.createElement('div');
        title.className = 'title-wrap';
        const imageWrap = document.createElement('div');
        imageWrap.className = 'image-wrap';
        const image = document.createElement('img');
        image.src = 'https://www.torn.com/images/items/206/large.png';
        imageWrap.appendChild(image);
        title.appendChild(imageWrap);
        row.item.prepend(title);
        return row;
    }

    it('clears the quantities of a freshly filled item on the next Add tap', async () => {
        vi.useFakeTimers();
        try {
            const requests = [];
            const { QP, bubble } = mountBubble(
                { tornApiKey: 'abcDEF1234567890' },
                options => requests.push(options)
            );
            const row = addFillableItem();

            const run = QP.fillAllItems();
            await vi.advanceTimersByTimeAsync(0);
            requests[0].onload({ responseText: JSON.stringify({ items: [
                { id: 206, value: { market_price: 100, sell_price: 90 } }
            ] }) });
            await run;

            expect(row.quantityControl.value).toBe('1');
            expect(row.priceInput.value).toBe('100');
            expect(QP.isBubbleActionClear()).toBe(true);

            pointer(bubble, 'pointerdown', { pointerId: 11 });
            pointer(bubble, 'pointerup', { pointerId: 11 });

            expect(row.quantityControl.value).toBe('');
            expect(row.priceInput.value).toBe('100');
            expect(requests).toHaveLength(1);
            expect(QP.getBubbleMode()).toBe('fill');
            expect(bubble.textContent).toBe('Fill');
        } finally {
            vi.useRealTimers();
        }
    });

    it('switches to the clear state even when every price fetch failed', async () => {
        vi.useFakeTimers();
        try {
            const requests = [];
            const { QP, bubble } = mountBubble(
                { tornApiKey: 'abcDEF1234567890' },
                options => requests.push(options)
            );
            addFillableItem();

            const run = QP.fillAllItems();
            await vi.advanceTimersByTimeAsync(0);
            // A v2 response with no usable item value falls back to v1, which
            // still resolves the item (with a zero price) so the batch settles.
            requests[0].onload({ responseText: JSON.stringify({ items: [{ id: 206 }] }) });
            await vi.advanceTimersByTimeAsync(600);
            expect(requests[1].url).toContain('/torn/206?selections=items');
            requests[1].onload({ responseText: JSON.stringify({ items: {} }) });
            await run;

            expect(QP.getBubbleMode()).toBe('clear');
            expect(bubble.innerHTML).toBe(iconHtml(QP, 'close'));
            expect(bubble.getAttribute('aria-label')).toBe('Clear quantities');
        } finally {
            vi.useRealTimers();
        }
    });

    it('returns the Manage bubble to the refresh state after Update All', async () => {
        vi.useFakeTimers();
        try {
            window.location.hash = '#/manage';
            const requests = [];
            const { QP, bubble } = mountBubble(
                { tornApiKey: 'abcDEF1234567890' },
                options => requests.push(options)
            );
            pointer(bubble, 'pointerdown', { pointerId: 12 });
            pointer(bubble, 'pointerup', { pointerId: 12 });
            await vi.advanceTimersByTimeAsync(0);

            expect(requests).toHaveLength(0);
            expect(document.querySelector('.qp-toast-error')?.textContent).toContain('No items found to update!');
            expect(bubble.innerHTML).toBe(iconHtml(QP, 'refresh'));
            expect(QP.getBubbleMode()).toBe('fill');
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('v2.9.4 changelog order and settings info action', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        window.location.hash = '';
        vi.restoreAllMocks();
    });

    it('lists the user-visible v2.9.4 changes first, in priority order', () => {
        const { QP } = loadScript();
        QP.showChangelog();
        const items = [...document.querySelectorAll('.qp-changelog__list li')].map(li => li.textContent);

        const order = [
            /clears all listed quantities/i,
            /Long-press the bubble to open Settings/i,
            /info button in the Settings header opens the changelog/i,
            /Clear cache is now a text-only button/i,
            /route-aware actions/i,
            /floating control is now a circular Material 3 bubble/i,
            /API v2 batches/i,
            /PDA initialization/i,
            /v1 fallback and rate-limit safeguards/i
        ];
        expect(items).toHaveLength(order.length);
        order.forEach((note, index) => expect(items[index]).toMatch(note));
    });

    it('exposes the settings header as a labelled button that is not a decorative gear', () => {
        const { QP } = loadScript();
        QP.showSettingsPanel();
        const info = document.querySelector('#qpSettingsInfo');

        expect(info.tagName).toBe('BUTTON');
        expect(info.type).toBe('button');
        expect(info.getAttribute('aria-label')).toMatch(/what'?s new/i);
        expect(info.querySelector('svg')).toBeTruthy();
        expect(info.querySelector('svg').innerHTML).toBe(
            (() => {
                const holder = document.createElement('div');
                holder.innerHTML = QP.getMaterialIcon('info');
                return holder.querySelector('svg').innerHTML;
            })()
        );
        document.querySelector('.qp-overlay').remove();
    });

    it.each([
        ['click', target => target.click()],
        ['Enter', target => target.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))],
        ['Space', target => target.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))]
    ])('closes settings and opens the changelog on %s', (_label, activate) => {
        const { QP } = loadScript();
        QP.showSettingsPanel();
        const settingsOverlay = document.querySelector('.qp-overlay');
        activate(settingsOverlay.querySelector('#qpSettingsInfo'));

        expect(document.body.contains(settingsOverlay)).toBe(false);
        expect(document.querySelectorAll('.qp-overlay')).toHaveLength(1);
        expect(document.querySelector('.qp-head__title')?.textContent).toBe("What's new");
        expect(document.querySelector('.qp-changelog__list li')?.textContent).toMatch(/clears all listed quantities/i);
    });

    it('keeps the Clear cache button text-only and reports its cleared state as text', () => {
        vi.useFakeTimers();
        try {
            const { QP } = loadScript();
            QP.showSettingsPanel();
            const button = document.querySelector('#qpClearCache');

            expect(button.querySelector('svg')).toBeNull();
            expect(button.textContent.trim()).toBe('Clear cache');

            button.click();
            expect(button.textContent).toContain('Cleared');
            vi.advanceTimersByTime(1500);
            expect(button.textContent.trim()).toBe('Clear cache');
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not focus the API key input when the info action opens the changelog', () => {
        const { QP } = loadScript();
        QP.showSettingsPanel();
        document.querySelector('#qpSettingsInfo').click();

        expect(document.activeElement).not.toBe(document.querySelector('#qpApiKey'));
        expect(document.activeElement).toBe(document.querySelector('#qpChangelogClose'));
    });
});
