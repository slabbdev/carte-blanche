# Catalog

Real-product catalog (Channel3) for the shopping scene

```ts
const catalogApi = new CatalogApi(client);
```

## Class Name

`CatalogApi`


# Search Catalog

Backed by Channel3 (100M+ retail offers) when CHANNEL3_API_KEY is set; otherwise serves clearly-labeled sample products so the demo works offline.

```ts
async searchCatalog(
  q?: string,
  requestOptions?: RequestOptions
): Promise<ApiResponse<ApiCatalogResponse>>
```

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `q` | `string \| undefined` | Query, Optional | - |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: Products with source label

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`ApiCatalogResponse`](../../doc/models/api-catalog-response.md).

## Example Usage

```ts
const q = 'merino wool sweater';

try {
  const response = await catalogApi.searchCatalog(q);

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

