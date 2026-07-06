import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SCRIPT_PATH = require.resolve('../torn-bazaar-quick-pricer.user.js');

/**
 * Load a fresh instance of the userscript with GM_* stubbed against an
 * in-memory storage object. Returns the script's test exports plus the
 * storage so tests can inspect persisted values.
 */
export function loadScript(storage = {}) {
    globalThis.GM_getValue = (key, def) => (key in storage ? storage[key] : def);
    globalThis.GM_setValue = (key, val) => { storage[key] = val; };
    globalThis.GM_xmlhttpRequest = () => {};
    globalThis.GM_info = { script: { version: '2.9' } };
    delete require.cache[SCRIPT_PATH];
    const QP = require(SCRIPT_PATH);
    return { QP, storage };
}
