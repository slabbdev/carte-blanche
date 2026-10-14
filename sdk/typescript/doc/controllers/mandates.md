# Mandates

Issue, list and revoke spending mandates

```ts
const mandatesApi = new MandatesApi(client);
```

## Class Name

`MandatesApi`

## Methods

* [List Mandates](../../doc/controllers/mandates.md#list-mandates)
* [Revoke Mandate](../../doc/controllers/mandates.md#revoke-mandate)


# List Mandates

List all signed spending mandates, newest first, each with its captured cumulative spend (from the sealed journal) and revocation state. Immutability note: limits never change after creation — only revocation alters behaviour.

```ts
async listMandates(
  requestOptions?: RequestOptions
): Promise<ApiResponse<ApiMandatesResponse>>
```

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: All mandates with their revocation status

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`ApiMandatesResponse`](../../doc/models/api-mandates-response.md).

## Example Usage

```ts
try {
  const response = await mandatesApi.listMandates();

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

