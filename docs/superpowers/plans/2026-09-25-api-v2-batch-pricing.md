# API v2 Batch Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce uncached Quick Fill network requests by batching item IDs through Torn API v2 while preserving the existing cache, rate-limit safeguards, and v1 fallback.

**Architecture:** Keep the current in-memory/persisted cache and serialized request queue. Add pure v2 URL/response helpers, collect synchronously registered uncached IDs into conservative 10-ID batches, and normalize successful v2 results into the existing `{ marketValue, sellPrice }` shape. If a v2 response is unusable or fails non-fatally, enqueue the same IDs through the existing v1 request path.

**Tech Stack:** Single-file Tampermonkey userscript, browser `GM_xmlhttpRequest`, Node `node:test`-style Vitest + jsdom harness, ESLint.

**Spec:** `docs/superpowers/specs/2026-09-25-api-v2-batch-pricing-design.md`

## Global Constraints

- Keep the userscript version at `2.9.3`; do not bump the version for this change.
- Use a conservative v2 batch size of exactly `10` item IDs.
- Keep request spacing at exactly `600` ms between network requests; batching must reduce request count, not increase request frequency.
- Preserve the existing cache format `{ marketValue, sellPrice, timestamp }` and cache lifetime behavior.
- Preserve v1 as a real fallback; do not remove or rewrite the existing v1 URL and response handling.
- A v2 response with zero parseable items out of a non-empty returned `items` array is a schema-shape failure and must route the whole batch to v1; do not cache all zero prices.
- A single malformed/missing item inside an otherwise parseable batch resolves only that item as `{ marketValue: 0, sellPrice: 0 }`; valid items in the same batch must still complete.
- Fatal v2 errors (codes `2`, `8`, and `9`) use the existing fatal handling and must not silently fall back.
- Rate-limit error code `5` uses the existing 5-second backoff and two-retry limit before v1 fallback.
- Do not change quantity parsing, pricing calculations, API key handling, cache persistence, UI behavior, or DOM selectors in this plan.
- Do not issue an unbounded burst of requests; the queue remains serialized.

## Review Focus

- A cold/expired run with several unique uncached IDs must produce fewer HTTP requests than the current one-request-per-ID path.
- A fully fresh cache must produce zero HTTP requests.
- A v2 response where `value.market_price` is absent for every returned item must trigger one v1 fallback for the entire batch, not a cache of zeros.
- A mixed v2 batch with one valid item and one missing/malformed item must resolve the valid item and zero only the malformed item without an unnecessary fallback.
- The generated v2 URL for 10 IDs must remain comfortably below a practical 2,000-character URL ceiling.

---

## File Structure

- Modify `torn-bazaar-quick-pricer.user.js`: v2 helpers, queue branch, batch scheduling, v1 fallback, and test exports.
- Modify `tests/load-script.js`: allow tests to provide a controllable `GM_xmlhttpRequest` stub.
- Modify `tests/script.test.js`: helper, cache, batching, mixed-response, and fallback tests.
- Modify `README.md`: document that batch pricing is cache-first and v2-backed only after behavior is verified.
- Modify `CHANGELOG.md`: add an Unreleased section describing the implementation without changing the current 2.9.3 version.
- Modify `docs/feature-research/api-v2-batch-pricing.md`: record any implementation findings and the live smoke-test result.

## Conflict Scan

| Shared boundary | Producer | Consumer | Finding |
|---|---|---|---|
| Queue entries | `fetchItemData` registers callbacks in `pendingRequests` | `processRequestQueue` resolves entries | Existing callback deduplication remains authoritative; batch entries must not resolve IDs outside the request's `itemIds`. |
| Cache shape | `parseV2ItemsResponse` normalizes values | `cachePrice` and pricing functions consume values | Parser must emit numeric `marketValue`/`sellPrice`; `sell_price: null` normalizes to `0`. |
| Test harness | `loadScript` installs request stub | queue tests trigger `onload`/`onerror` | Harness change must preserve the default no-op stub and existing test callers. |
| Docs/version | README/changelog describe behavior | release metadata remains 2.9.3 | Documentation must not claim a new released version. |

The scan is clean: no task requires changing the cache schema, quantity behavior, or existing v1 public behavior.

---

### Task 1: Add v2 request and response adapters

**Files:**
- Modify: `torn-bazaar-quick-pricer.user.js:935-1061` and the test export block near lines 1748-1768
- Modify: `tests/load-script.js:1-19`
- Modify: `tests/script.test.js:1-273`

**Interfaces:**
- Produces `V2_BATCH_SIZE = 10`.
- Produces `buildV2ItemsUrl(itemIds, apiKey)` returning the v2 item URL.
- Produces `parseV2ItemsResponse(data, requestedIds)` returning `{ values, parsedIds }`, where `values` maps IDs to normalized values and `parsedIds` is the set/list of IDs that matched the expected schema.
- `loadScript(storage, requestHandler)` accepts an optional request handler while retaining the current no-op default.

- [ ] **Step 1: Extend the test harness with an injectable request stub**

Change `tests/load-script.js` so callers can pass an optional second argument:

```js
export function loadScript(storage = {}, requestHandler = () => {}) {
    globalThis.GM_getValue = (key, def) => (key in storage ? storage[key] : def);
    globalThis.GM_setValue = (key, val) => { storage[key] = val; };
    globalThis.GM_xmlhttpRequest = requestHandler;
    globalThis.GM_info = { script: { version: '2.9.3' } };
    delete require.cache[SCRIPT_PATH];
    const QP = require(SCRIPT_PATH);
    return { QP, storage };
}
```

Keep the existing default behavior and existing single-argument callers unchanged.

- [ ] **Step 2: Add failing helper tests**

Add tests for:

```js
expect(QP.V2_BATCH_SIZE).toBe(10);
expect(QP.buildV2ItemsUrl([206, 207], 'abcDEF1234567890'))
    .toBe('https://api.torn.com/v2/torn/206,207/items?key=abcDEF1234567890');
```

Add parser tests for a valid item:

```js
const result = QP.parseV2ItemsResponse({
    items: [{ id: 206, value: { market_price: 830000, sell_price: 750000 } }]
}, [206]);
expect(result.values[206]).toEqual({ marketValue: 830000, sellPrice: 750000 });
expect(result.parsedIds).toEqual([206]);
```

Add tests that `sell_price: null` normalizes to `0`, a valid zero market price remains a parsed item, and an item without the expected schema is not counted as parsed.

- [ ] **Step 3: Run the focused tests and verify they fail**

Run:

```bash
npx vitest run tests/script.test.js
```

Expected: FAIL because the new helpers are not yet exported/implemented.

- [ ] **Step 4: Implement the minimal pure helpers**

Add constants and helpers near the API request queue:

```js
const V2_BATCH_SIZE = 10;

function buildV2ItemsUrl(itemIds, apiKey) {
    return `https://api.torn.com/v2/torn/${itemIds.join(',')}/items?key=${apiKey}`;
}

function parseV2ItemsResponse(data, requestedIds) {
    const values = {};
    const parsedIds = [];
    const requested = new Set(requestedIds.map(Number));
    if (!Array.isArray(data?.items)) return { values, parsedIds };

    for (const item of data.items) {
        const itemId = Number(item?.id);
        if (!requested.has(itemId)) continue;
        const value = item?.value;
        const hasExpectedSchema = value && typeof value === 'object' &&
            typeof value.market_price === 'number' && Number.isFinite(value.market_price);
        if (!hasExpectedSchema) continue;

        values[itemId] = {
            marketValue: value.market_price,
            sellPrice: typeof value.sell_price === 'number' && Number.isFinite(value.sell_price)
                ? value.sell_price
                : 0
        };
        parsedIds.push(itemId);
    }
    return { values, parsedIds };
}
```

Export `V2_BATCH_SIZE`, `buildV2ItemsUrl`, and `parseV2ItemsResponse` in the Node test hook.

- [ ] **Step 5: Run the focused tests and verify they pass**

Run:

```bash
npx vitest run tests/script.test.js
```

Expected: PASS, including the new helper tests and all existing tests.

- [ ] **Step 6: Commit Task 1**

```bash
git add torn-bazaar-quick-pricer.user.js tests/load-script.js tests/script.test.js
git commit -m "test: add API v2 price response adapters"
```

---

### Task 2: Integrate serialized v2 batches with v1 fallback

**Files:**
- Modify: `torn-bazaar-quick-pricer.user.js:939-1061`
- Modify: `torn-bazaar-quick-pricer.user.js:1037-1061`
- Modify: `tests/script.test.js`

**Interfaces:**
- Consumes `V2_BATCH_SIZE`, `buildV2ItemsUrl`, and `parseV2ItemsResponse` from Task 1.
- Preserves `fetchItemData(itemId, callback)` and `pendingRequests` callback behavior.
- Queue entries use `{ type: 'v2-batch', itemIds: number[], retries: number }` and `{ type: 'v1', itemIds: number[], retries: number }`.

- [ ] **Step 1: Add failing queue integration tests**

Add tests that:

1. Register two uncached fetches synchronously and assert one v2 request contains both IDs and both callbacks receive normalized values.
2. Populate the cache through that request and assert subsequent fetches do not add requests.
3. Respond to a v2 batch with a valid item plus a missing-value item and assert the valid callback gets data, the missing callback gets zeros, and only one request is made.
4. Respond to a v2 batch with a non-empty `items` array where no item has `value.market_price` and assert a v1 request follows for the whole batch and no zero entries are cached from the failed shape.
5. Respond to v2 with a fatal code `2` and assert the v1 fallback is not requested.
6. Assert the generated v2 URL for 10 IDs remains below 2,000 characters.

Use the injectable request handler from Task 1 and invoke captured request callbacks asynchronously. Tests must assert both request URLs and callback results, not merely that the functions exist.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
npx vitest run tests/script.test.js
```

Expected: FAIL because the queue still sends one v1 request per item.

- [ ] **Step 3: Add a zero-delay queue scheduler**

Replace the immediate `processRequestQueue()` call in `fetchItemData` with a scheduler:

```js
let requestQueueTimer = null;

function scheduleRequestQueue() {
    if (requestQueueTimer !== null) return;
    requestQueueTimer = setTimeout(() => {
        requestQueueTimer = null;
        processRequestQueue();
    }, 0);
}
```

Register the item callback as before, push a v2 queue entry, and call `scheduleRequestQueue()`. This allows a synchronous `Quick Fill` map to register all rows before the first network request starts.

- [ ] **Step 4: Add a v2 queue branch**

At the start of `processRequestQueue`, retain the existing guards and then branch on `entry.type`:

- For `v2-batch`, collect up to `V2_BATCH_SIZE` consecutive queue item IDs, remove those entries, and issue one `GM_xmlhttpRequest` to `buildV2ItemsUrl(itemIds, CONFIG.apiKey)`.
- On successful JSON with a non-empty returned `items` array and at least one parsed item, cache and finish parsed IDs with their values, finish missing/malformed requested IDs with zeros, and release after `REQUEST_SPACING_MS`.
- On a non-array/empty response, or a non-empty array with zero parsed items, enqueue v1 entries for all batch IDs and release after `REQUEST_SPACING_MS`.
- On v2 error code `5`, retry the v2 batch using the existing 5-second delay and two-retry limit; after the retry limit, enqueue v1 entries.
- On fatal codes `2`, `8`, and `9`, use the existing fatal handling and do not enqueue v1 entries.
- On parse/network/timeout/abort failure, enqueue v1 entries once and release after `REQUEST_SPACING_MS`.

Do not call `finishRequest` for an ID not in the batch's `itemIds`.

- [ ] **Step 5: Refactor the existing v1 branch without changing its contract**

Move the current per-item URL construction and response parsing into the `v1` branch. Preserve:

- `market_value` and `sell_price` normalization;
- cache writes;
- 600 ms spacing;
- timeout/error handling;
- rate-limit and fatal behavior;
- callback invocation exactly once.

For v1 entries created by a v2 fallback, use the same `pendingRequests` callback map; do not create a second callback map or bypass deduplication.

- [ ] **Step 6: Run focused tests and verify they pass**

Run:

```bash
npx vitest run tests/script.test.js
```

Expected: PASS for batching, mixed responses, full schema fallback, fatal handling, cache reuse, URL length, and all prior tests.

- [ ] **Step 7: Run lint and the full suite**

Run:

```bash
npm run lint
npm test
git diff --check
```

Expected: all commands pass.

- [ ] **Step 8: Commit Task 2**

```bash
git add torn-bazaar-quick-pricer.user.js tests/script.test.js
git commit -m "feat: batch uncached item prices through API v2"
```

---

### Task 3: Verify live response shape and document the verified behavior

**Files:**
- Modify: `docs/feature-research/api-v2-batch-pricing.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes the tested v2 implementation from Task 2.
- Does not change the userscript version; current version remains 2.9.3.

- [ ] **Step 1: Run a live Public-key smoke test**

Use a valid Public key only through the userscript's normal API path. Confirm that a v2 request for multiple IDs returns an `items` array whose values expose numeric `market_price` and `sell_price` (with `sell_price: null` allowed), and confirm the script caches and fills the corresponding rows. Do not write the key to logs, documentation, or version-controlled files.

If no live key is available, record the smoke test as blocked and do not claim production verification; unit tests and documentation may still describe the implementation as awaiting live verification.

- [ ] **Step 2: Update the research record**

Append the actual response shape observed, the result of the smoke test, the selected 10-ID batch size, the measured URL length for a representative batch, and any deviation from the OpenAPI schema.

- [ ] **Step 3: Update README behavior documentation**

Document that:

- fresh cache entries still use no network request;
- uncached IDs are collected into v2 batches of 10;
- request spacing remains 600 ms;
- schema failures fall back to v1;
- the API v2 path is limited to price lookup and does not convert the entire script.

Do not claim that a new release exists and do not change the 2.9.3 version.

- [ ] **Step 4: Add an Unreleased changelog entry**

Add an `Unreleased` section describing the cache-first v2 batching and v1 fallback. Keep the top-level current version at 2.9.3.

- [ ] **Step 5: Run final verification**

Run:

```bash
npm run lint
npm test
git diff --check
git status --short --branch
```

Expected: lint, all tests, and diff validation pass; only intended files are modified.

- [ ] **Step 6: Commit Task 3**

```bash
git add docs/feature-research/api-v2-batch-pricing.md README.md CHANGELOG.md
git commit -m "docs: describe batched price lookup"
```

---

## Plan Self-Review

### Spec coverage

- Cache-first behavior: Tasks 1–2 and existing cache tests.
- v2 comma-separated endpoint: Task 1 URL helper and Task 2 queue branch.
- 10-ID URL-length ceiling: Task 1 constant and Task 2 URL test.
- v1 fallback: Task 2 queue integration tests.
- Schema-shape failure fallback: Task 1 parser and Task 2 full-batch fallback test.
- Mixed valid/malformed item handling: Task 2 mixed-response test.
- Rate limit, fatal errors, timeout, and spacing: Task 2 branch plus preserved v1 behavior.
- No version bump: Global Constraints and Task 3 documentation rules.
- Live field-name verification: Task 3 smoke test.

### Placeholder scan

No plan steps use `TBD`, `TODO`, or unspecified "appropriate" error handling. All required values and fallback outcomes are explicit.

### Type consistency

The queue uses `type: 'v2-batch' | 'v1'`, `itemIds: number[]`, and `retries: number`. Task 1's `parseV2ItemsResponse` returns `{ values, parsedIds }`; Task 2 consumes `values` for callbacks/cache and `parsedIds.length` for the schema-failure decision. `buildV2ItemsUrl(itemIds, apiKey)` and `loadScript(storage, requestHandler)` are defined before use.

### Review focus coverage

Each Review Focus item has an owning test in Task 1 or Task 2, except the live production field-name confirmation, which is explicitly required in Task 3.
