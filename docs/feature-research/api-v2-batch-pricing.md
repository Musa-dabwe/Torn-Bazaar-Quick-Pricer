# Research: API v2 Batch Pricing

## Search Terms Used
- Torn API 100 requests per minute
- Torn API service cache and global cache
- Torn API v2 `/torn/{ids}/items`
- comma-separated item IDs
- `priceCache`, `fetchItemData`, `requestQueue`

## Existing Code Found
- `torn-bazaar-quick-pricer.user.js:118-149`: persists a price cache keyed by item ID and expires entries using `CONFIG.cacheTimeout`.
- `torn-bazaar-quick-pricer.user.js:939-961`: serializes uncached requests through a queue with a 600 ms spacing, deduplication, and fatal-error handling.
- `torn-bazaar-quick-pricer.user.js:988-1021`: requests API v1 item data one item at a time using `https://api.torn.com/torn/${itemId}?selections=items`.
- `torn-bazaar-quick-pricer.user.js:1037-1061`: `fetchItemData` serves fresh cache entries immediately and queues only uncached item IDs.
- `torn-bazaar-quick-pricer.user.js:1594-1625`: Quick Fill creates all row promises immediately, but uncached rows complete as the serial request queue progresses.
- `tests/script.test.js:249-272`: verifies cache freshness, stale-entry pruning, and clearing; no request-queue or batch-response tests currently exist.

## Primary Documentation Found
- Torn API documentation: https://www.torn.com/api.html
  - States that each user may make up to 100 individual requests per minute across all keys.
  - States that service caching can last up to 30 seconds and identical requests may be returned from cache.
  - Lists globally cached selections including `market -> itemmarket`.
  - The current script does not use that selection; it uses `torn -> items` for each item ID.
- Torn API v2 OpenAPI specification: https://www.torn.com/swagger/openapi.json
  - Defines `GET /torn/{ids}/items`.
  - Defines the `ids` path parameter as an item ID or a comma-separated list of item IDs.
  - Requires a Public key.
  - Returns `TornItemsResponse` with an `items` array.
  - Each `TornItem` contains `id` and `value.market_price` / `value.sell_price` data.

## Existing Patterns
- Cache values are already normalized to `{ marketValue, sellPrice }`, so v2 parsing can feed the existing pricing path without changing pricing or DOM code.
- The request queue already centralizes retry, rate-limit, timeout, fatal-error, and deduplication behavior. Batch fetching should use the same queue rather than bypass it.
- The current cache is an in-memory copy of a persisted GM value. Batch results should call the existing `cachePrice` function so persistence and expiry remain consistent.

## Root Cause / Performance Finding
The script does not ask Torn for the user's item count. It must inspect each visible row locally to discover its item ID, but that is not the slow operation. The slow operation is the current cache-miss path: every distinct uncached item ID creates a separate v1 HTTP request, and the queue waits 600 ms between requests. The cache therefore works as designed, but it cannot reduce the request count for a cold or expired run.

## New Implementation Required
- Add a v2 batch lookup path for uncached item IDs.
- Convert the v2 response into the existing `{ marketValue, sellPrice }` cache shape.
- Resolve all callbacks associated with every item in a successful batch.
- Keep v1 per-item lookup as a fallback when v2 is unavailable or returns an unusable response.
- Preserve the 100-request/minute safety target by spacing batches no faster than the existing 600 ms interval.
- Add unit coverage for v2 URL construction, parsing, callback resolution, cache population, and fallback behavior.
- Avoid changing API key handling, pricing calculations, quantity handling, UI behavior, or cache storage format.

## Implementation Constraints
- Do not reduce the 600 ms request spacing merely to make uncached fills appear faster; batching is the required optimization.
- Do not remove the v1 fallback without live verification of v2 behavior.
- Do not assume a v2 response item has a nonzero value; malformed or missing items must resolve as failed without blocking other rows.
- Keep the queue serial and bounded; do not issue an unbounded burst of batch requests.

## Initial Implementation Plan
1. Add a v2 batch request/response adapter around the existing queue and cache interfaces.
2. Add unit tests for URL construction, response normalization, cache population, callback resolution, and v1 fallback.
3. Run lint and tests, then manually validate a real Public-key v2 request before publishing.
4. Update documentation only after behavior is verified.

## Implementation Status
- Implemented and unit-tested: fresh cache entries are served locally; cache misses enter the existing serial queue and are coalesced into API v2 batches of up to 10 item IDs.
- Successful v2 values are normalized to the existing cache shape and written through the existing cache path. The queue retains its 600 ms spacing between every request, including v1 fallback requests.
- If the v2 response has no usable expected-schema items, the whole batch falls back to the existing per-item v1 path. A mixed response keeps valid items and fails only malformed items.
- The API v2 migration is limited to public price lookup. Pricing, quantity handling, DOM updates, cache storage, and key handling remain unchanged.
- v2.9.4 is the current userscript and project release. The API v2 batching and manual
  verification described here are completed; the separate live desktop/PDA smoke test
  remains pending as a release gate.

## Batch Size and URL-Length Rationale
- The selected maximum is **10 item IDs per v2 request**. This materially reduces cold-cache request count while keeping each URL bounded and the queue serial. A unit test also asserts that a 10-ID URL remains below 2,000 characters.
- A representative URL using IDs 1 through 10 and a 16-character dummy key is 76 characters. Using current-style four-digit IDs 3770 through 3779 is 77 characters, leaving substantial margin below the tested 2,000-character ceiling.
- The key is included only to describe URL length with a dummy value. No real API key was requested, used, or recorded.

## Live Smoke-Test Status
- **API response shape verified:** a live read-only request to Torn API v2 for item IDs `206,207` returned HTTP 200 with an `items` array. Each returned item had a numeric `value.market_price` and `value.sell_price: null`, matching the parser contract. No key or request URL was recorded in the repository.
- **Userscript performance verified manually:** the user installed the local test export, ran the real script, and confirmed that items fill in batches of 10 rows and substantially faster than the previous one-row-at-a-time behavior.
- The implementation matches the OpenAPI shape `items[]`, with each valid item containing numeric `id` and `value.market_price`; `value.sell_price` may be numeric or `null` and is normalized to zero when null.
- Automated tests cover cache reuse and zero-request behavior; the manual report confirmed the batched fill path and speed improvement, but did not separately measure a second cached run.
- The Public key used for the direct API check was not stored in the repository and should be deleted or rotated as planned.
