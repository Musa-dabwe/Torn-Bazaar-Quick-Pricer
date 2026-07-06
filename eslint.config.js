'use strict';

const browserGlobals = {
    window: 'readonly',
    document: 'readonly',
    console: 'readonly',
    location: 'readonly',
    alert: 'readonly',
    confirm: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    MutationObserver: 'readonly',
    Event: 'readonly',
    HTMLDivElement: 'readonly',
    HTMLButtonElement: 'readonly'
};

const userscriptGlobals = {
    GM_getValue: 'readonly',
    GM_setValue: 'readonly',
    GM_xmlhttpRequest: 'readonly',
    GM_info: 'readonly',
    module: 'readonly'
};

module.exports = [
    {
        ignores: ['node_modules/**', 'coverage/**']
    },
    {
        files: ['*.user.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: { ...browserGlobals, ...userscriptGlobals }
        },
        rules: {
            'no-unused-vars': ['error', { args: 'none' }],
            'no-undef': 'error',
            eqeqeq: ['error', 'smart'],
            'no-var': 'error',
            'prefer-const': 'error'
        }
    },
    {
        files: ['tests/**/*.js', 'vitest.config.mjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...browserGlobals,
                globalThis: 'readonly',
                process: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': ['error', { args: 'none' }],
            'no-undef': 'error'
        }
    },
    {
        files: ['eslint.config.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: { module: 'writable', require: 'readonly' }
        }
    }
];
