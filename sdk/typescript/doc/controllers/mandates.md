# Mandates

Issue, list and revoke spending mandates

```ts
const mandatesApi = new MandatesApi(client);
```

## Class Name

`MandatesApi`

## Methods

* [Create Mandate](../../doc/controllers/mandates.md#create-mandate)
* [Revoke Mandate](../../doc/controllers/mandates.md#revoke-mandate)


# Create Mandate

Mandates are immutable: limits (per-transaction cap, total cap, currency, payee allowlist, time window) are signed at creation and only revocation changes behaviour.

```ts
async createMandate(
  body: CreateMandateRequest,
  requestOptions?: RequestOptions
): Promise<ApiResponse<SignedMandate>>
```

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `body` | [`CreateMandateRequest`](../../doc/models/create-mandate-request.md) | Body, Required | - |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: The mandate with its Ed25519 signature and public key

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`SignedMandate`](../../doc/models/signed-mandate.md).

## Example Usage

```ts
const body: CreateMandateRequest = {
  principal: 'acme-corp',
  agent: 'procurement-agent',
  currency: 'USD',
  maxPerTransaction: '30.00',
  maxTotalSpend: '60.00',
  purpose: 'office supplies',
  windowEnd: '2026-10-13T00:00:00.000Z',
};

try {
  const response = await mandatesApi.createMandate(body);

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
    if (error instanceof CustomError) {
      console.log(error.result);
    }
  }
}
```

## Errors

| HTTP Status Code | Error Description | Exception Class |
|  --- | --- | --- |
| 400 | Malformed request | [`CustomError`](../../doc/models/custom-error.md) |


# Revoke Mandate

Revocation is the only exit after issuance; it is journalled like every other event.

```ts
async revokeMandate(
  id: string,
  body?: ApiMandatesRevokeRequest,
  requestOptions?: RequestOptions
): Promise<ApiResponse<void>>
```

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Template, Required | - |
| `body` | [`ApiMandatesRevokeRequest \| undefined`](../../doc/models/api-mandates-revoke-request.md) | Body, Optional | - |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: Revocation recorded and journalled

This method returns an [`ApiResponse`](../../doc/api-response.md) instance.

## Example Usage

```ts
const id = 'id0';

try {
  const response = await mandatesApi.revokeMandate(id);

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

