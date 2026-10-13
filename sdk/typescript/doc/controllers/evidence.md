# Evidence

Receipts, refusals, portable verification, sealed journal

```ts
const evidenceApi = new EvidenceApi(client);
```

## Class Name

`EvidenceApi`

## Methods

* [List Receipts](../../doc/controllers/evidence.md#list-receipts)
* [Verify Receipt](../../doc/controllers/evidence.md#verify-receipt)
* [Verify Denial](../../doc/controllers/evidence.md#verify-denial)
* [Verify Journal](../../doc/controllers/evidence.md#verify-journal)
* [List Events](../../doc/controllers/evidence.md#list-events)
* [Journal Anchor](../../doc/controllers/evidence.md#journal-anchor)
* [Journal Anchor Token](../../doc/controllers/evidence.md#journal-anchor-token)
* [Journal Anchor Request](../../doc/controllers/evidence.md#journal-anchor-request)
* [Health](../../doc/controllers/evidence.md#health)


# List Receipts

```ts
async listReceipts(
  requestOptions?: RequestOptions
): Promise<ApiResponse<ApiReceiptsResponse>>
```

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: Receipts and signed refusals, newest first

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`ApiReceiptsResponse`](../../doc/models/api-receipts-response.md).

## Example Usage

```ts
try {
  const response = await evidenceApi.listReceipts();

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
  }
}
```


# Verify Receipt

Re-runs every check server-side: mandate signature, event re-hash, receipt-to-event linkage, receipt signature, Merkle inclusion against the signed tree head, and the RFC 3161 TSA anchor when present.

```ts
async verifyReceipt(
  id: string,
  requestOptions?: RequestOptions
): Promise<ApiResponse<ApiVerifyReceiptsResponse>>
```

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Template, Required | - |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: Verification report with per-check results

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`ApiVerifyReceiptsResponse`](../../doc/models/api-verify-receipts-response.md).

## Example Usage

```ts
const id = 'id0';

try {
  const response = await evidenceApi.verifyReceipt(id);

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
  }
}
```


# Verify Denial

```ts
async verifyDenial(
  id: string,
  requestOptions?: RequestOptions
): Promise<ApiResponse<void>>
```

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Template, Required | - |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: Verification report

This method returns an [`ApiResponse`](../../doc/api-response.md) instance.

## Example Usage

```ts
const id = 'id0';

try {
  const response = await evidenceApi.verifyDenial(id);

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
  }
}
```


# Verify Journal

Re-hashes every event and walks the SHA-256 chain from genesis; returns the broken position if any tamper is detected.

```ts
async verifyJournal(
  requestOptions?: RequestOptions
): Promise<ApiResponse<ChainVerification>>
```

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: Chain verification + latest signed checkpoint

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`ChainVerification`](../../doc/models/chain-verification.md).

## Example Usage

```ts
try {
  const response = await evidenceApi.verifyJournal();

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
  }
}
```


# List Events

```ts
async listEvents(
  limit?: number,
  requestOptions?: RequestOptions
): Promise<ApiResponse<void>>
```

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `limit` | `number \| undefined` | Query, Optional | **Default**: `50`<br><br>**Constraints**: `<= 500` |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: Newest events first

This method returns an [`ApiResponse`](../../doc/api-response.md) instance.

## Example Usage

```ts
const limit = 50;

try {
  const response = await evidenceApi.listEvents(limit);

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
  }
}
```


# Journal Anchor

Returns the anchor with a live self-check (token imprint + nonce re-verified), plus the exact openssl commands for fully independent third-party verification.

```ts
async journalAnchor(
  requestOptions?: RequestOptions
): Promise<ApiResponse<void>>
```

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: Anchor status + token metadata + openssl instructions

This method returns an [`ApiResponse`](../../doc/api-response.md) instance.

## Example Usage

```ts
try {
  const response = await evidenceApi.journalAnchor();

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
  }
}
```


# Journal Anchor Token

The full RFC 3161 response from the Timestamp Authority, served for independent verification (openssl ts -verify -queryfile anchor.tsq -in anchor.tsr).

```ts
async journalAnchorToken(
  requestOptions?: RequestOptions
): Promise<ApiResponse<unknown>>
```

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: application/timestamp-reply bytes

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type `unknown`.

## Example Usage

```ts
try {
  const response = await evidenceApi.journalAnchorToken();

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
  }
}
```


# Journal Anchor Request

```ts
async journalAnchorRequest(
  requestOptions?: RequestOptions
): Promise<ApiResponse<void>>
```

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: application/timestamp-query bytes

This method returns an [`ApiResponse`](../../doc/api-response.md) instance.

## Example Usage

```ts
try {
  const response = await evidenceApi.journalAnchorRequest();

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
  }
}
```


# Health

```ts
async health(requestOptions?: RequestOptions): Promise<ApiResponse<Health>>
```

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: Rails mode, journal length, catalog mode, uptime

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`Health`](../../doc/models/health.md).

## Example Usage

```ts
try {
  const response = await evidenceApi.health();

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
  }
}
```

