# Design: API v2 Batch Pricing with v1 Fallback

**Date**: 2026-09-25
**Status**: Approved design, pending implementation
**Scope**: Torn Bazaar Quick Pricer v2.9.3

## Problem

Uncached item prices are currently fetched one item at a time through API v1. The queue intentionally waits 600 ms between requests to remain within Torn's documented 100-request-per-minute limit. This is safe but makes large cold or expired Quick Fill runs appear to process rows sequentially.

The local price cache is functioning: it is keyed by item ID and fresh entries resolve without network calls. It does not cache the number of inventory rows, because the script must inspect each visible row locally to discover its item ID. The network cost comes from cache misses.

## Goals

1. Reduce the number of HTTP requests for uncached item prices.
2. Preserve Torn's request-limit safeguards.
3. Preserve the current cache format and all pricing behavior.
4. Keep the existing v1 request path as a safe fallback.
5. Add deterministic tests for the new request and response behavior.
6. Avoid changing the public userscript version until the behavior is verified.

## Non-goals

- Converting the entire userscript to API v2.
- Changing API key storage, permissions, or prompt behavior.
- Changing item quantity parsing or the earlier quantity-display bug investigation.
- Increasing concurrency beyond the current serial request model.
- Changing the cache persistence format or user-configurable cache lifetime.

## API evidence

Torn's official API v2 OpenAPI specification defines:

```text
GET /torn/{ids}/items
```

The `ids` path parameter accepts an item ID or a comma-separated list of item IDs. The endpoint requires a Public key and returns an `items` array. Each item includes an `id` and value data including `market_price` and `sell_price`.

Torn's API documentation states that users may make up to 100 individual requests per minute. The script will keep the existing 600 ms spacing between network requests; batching reduces the number of requests rather than increasing request frequency.

## Architecture

### Existing interfaces

- `getCachedPrice(itemId)` returns a fresh normalized cache entry or `null`.
- `cachePrice(itemId, marketValue, sellPrice)` stores the normalized entry and schedules persistence.
- `fetchItemData(itemId, callback)` resolves a callback with `{ marketValue, sellPrice }`, either from cache or through the request queue.
- `pendingRequests` deduplicates callbacks for an item ID.
- `requestQueue` serializes network work and applies retries, timeouts, fatal errors, and spacing.

### New v2 batch path

A new queue item type will represent a batch:

```js
{ type: 'batch', itemIds: [...], retries: 0 }
```

When the queue encounters an uncached item and v2 batching is available, it groups a bounded number of pending item IDs into one request:

```text
https://api.torn.com/v2/torn/{id1,id2,...}/items?key={key}
```

The response adapter will convert each returned item into the existing normalized shape:

```js
{
    marketValue: item.value?.market_price || 0,
    sellPrice: item.value?.sell_price || 0
}
```

It will call `cachePrice` for valid returned items and invoke every callback registered for each item ID. Missing or malformed items resolve as `{ marketValue: 0, sellPrice: 0 }` so one bad row cannot block the batch.

### v1 fallback

The existing v1 single-item request remains available and is used when:

- the v2 batch request fails with a non-rate-limit response;
- the v2 response shape is unusable;
- the v2 request times out or errors;
- the user/API conditions otherwise prevent a valid v2 result.

Fallback must not retry the same failed request indefinitely. Existing fatal and rate-limit behavior remains authoritative. A v2 failure will enqueue the affected item IDs through the current v1 path, with existing deduplication ensuring each item is fetched at most once concurrently.

### Queue behavior

The queue remains one-at-a-time. A successful v2 batch request releases the queue after 600 ms. Rate-limit error code 5 uses the existing backoff and retry limits. Fatal error codes 2, 8, and 9 still halt the run and fail pending callbacks.

The first implementation will use a conservative fixed batch size. The exact value will be selected during implementation and covered by tests; the design does not depend on an undocumented maximum.

## Error handling

- Invalid v2 JSON: fall back to v1 for the batch.
- Non-array `items`: fall back to v1 for the batch.
- One malformed item: resolve that item as failed, process valid items normally.
- V2 rate limit: use existing retry/backoff behavior before fallback.
- V2 fatal error: use existing fatal handling; do not silently retry with v1 when the key/IP/API is invalid or disabled.
- V2 timeout/network error: enqueue the batch IDs through v1 once.

## Testing strategy

Add tests around pure helpers or a controlled request adapter for:

- v2 URL construction and comma-separated IDs.
- v2 response normalization to `marketValue` and `sellPrice`.
- Missing values resolving to zero.
- Cache population from a successful batch.
- Multiple callbacks for multiple rows receiving results.
- V1 fallback after an unusable v2 response.
- Existing cache tests remaining green.
- Queue spacing/retry behavior remaining unchanged.

The existing test harness exports pure helpers and uses GM stubs. The implementation should keep network behavior injectable or export the smallest testable adapter necessary without making browser-only setup part of the pure-helper tests.

## Documentation and release

Keep the userscript version at 2.9.3 while implementing and testing. Update README/changelog/theme documentation only after the behavior is verified. If the change is released, create a new version entry then; this design does not authorize a version bump by itself.

## Acceptance criteria

- A cold/expired run with multiple unique uncached IDs can resolve them using fewer HTTP requests than the current one-request-per-ID path.
- A fully fresh cache performs no network requests.
- Existing v1 behavior remains available as a fallback.
- Rate limiting, retry, timeout, fatal-error, and cache behavior remain safe.
- Unit tests and lint pass.
- A real Public-key smoke test is performed before release.
