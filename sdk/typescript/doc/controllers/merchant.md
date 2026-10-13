# Merchant

Dispute cockpit and evidence packs

```ts
const merchantApi = new MerchantApi(client);
```

## Class Name

`MerchantApi`

## Methods

* [List Disputes](../../doc/controllers/merchant.md#list-disputes)
* [Evidence Pack](../../doc/controllers/merchant.md#evidence-pack)
* [Submit Evidence](../../doc/controllers/merchant.md#submit-evidence)


# List Disputes

```ts
async listDisputes(
  requestOptions?: RequestOptions
): Promise<ApiResponse<void>>
```

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: Dispute rows with deadline, receipt linkage and source

This method returns an [`ApiResponse`](../../doc/api-response.md) instance.

## Example Usage

```ts
try {
  const response = await merchantApi.listDisputes();

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


# Evidence Pack

Assembles from the sealed journal: the signed mandate, the receipt, the verified chain, the Merkle inclusion proof of the capture event, signed refusals on the mandate, and the TSA anchor.

```ts
async evidencePack(
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

**200**: Structured pack + markdown rendering

This method returns an [`ApiResponse`](../../doc/api-response.md) instance.

## Example Usage

```ts
const id = 'id0';

try {
  const response = await merchantApi.evidencePack(id);

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


# Submit Evidence

POSTs the pack through the Disputes API provide-evidence path. Sandbox reality: the endpoint is file-upload-only with a documents scope gated by an account manager — the submission attempt and its outcome are reported honestly.

```ts
async submitEvidence(
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

**200**: Submission attempt result with PayPal's own response

This method returns an [`ApiResponse`](../../doc/api-response.md) instance.

## Example Usage

```ts
const id = 'id0';

try {
  const response = await merchantApi.submitEvidence(id);

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

