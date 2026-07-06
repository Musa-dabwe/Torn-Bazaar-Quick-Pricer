import { describe, it, expect } from 'vitest';
import { loadScript } from './load-script.js';

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

    it('derives cacheTimeout from the minutes setting with a floor of 1', () => {
        const { QP } = loadScript({ cacheTimeoutMin: 10 });
        expect(QP.CONFIG.cacheTimeout).toBe(10 * 60 * 1000);
        const floored = loadScript({ cacheTimeoutMin: 0 });
        expect(floored.QP.CONFIG.cacheTimeout).toBe(60 * 1000);
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
