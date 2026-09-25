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
