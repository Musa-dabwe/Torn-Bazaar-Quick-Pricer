import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { loadScript } from './load-script.js';

const testDir = dirname(fileURLToPath(import.meta.url));

describe('Material icon map', () => {
    const { QP } = loadScript();
    const requiredIcons = [
        'info', 'inventory_2', 'refresh', 'settings', 'key', 'visibility',
        'visibility_off', 'add', 'undo', 'check_circle', 'error', 'warning',
        'sports_martial_arts', 'open_in_new', 'close', 'more_vert'
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
        ['.qp-item-btn svg', '.qp-chip-gear svg', '.qp-head__badge svg', '.qp-eye-toggle svg', '.qp-toast__icon svg', '.qp-btn svg']
            .forEach(selector => expect(css).toContain(`${selector} {`));
        expect(css).toMatch(/\.qp-head__badge\s*\{[^}]*color:\s*var\(--qp-accent\)/);
    });

    it('wires mapped icons into status, confirmation, close, overflow, and undo UI paths', () => {
        const script = readFileSync(resolve(testDir, '../torn-bazaar-quick-pricer.user.js'), 'utf8');
        ['check_circle', 'error', 'info', 'warning', 'sports_martial_arts', 'inventory_2', 'undo', 'open_in_new', 'close', 'more_vert']
            .forEach(name => {
                const uses = script.match(new RegExp(`getMaterialIcon\\('${name}'\\)`, 'g')) || [];
                expect(uses.length).toBeGreaterThanOrEqual(1);
            });
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
