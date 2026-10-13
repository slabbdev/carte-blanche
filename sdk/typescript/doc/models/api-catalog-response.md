
# Api Catalog Response

*This model accepts additional fields of type unknown.*

## Structure

`ApiCatalogResponse`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `source` | [`Source \| undefined`](../../doc/models/source.md) | Optional | - |
| `products` | [`Product[] \| undefined`](../../doc/models/product.md) | Optional | - |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { ApiCatalogResponse, Source } from 'carte-blanche-apilib';

const apiCatalogResponse: ApiCatalogResponse = {
  source: Source.Channel3,
  products: [
    {
      id: 'id2',
      title: 'title2',
      price: 'price0',
      currency: 'currency8',
      image: 'image4',
      additionalProperties: {
        'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
      },
    },
    {
      id: 'id2',
      title: 'title2',
      price: 'price0',
      currency: 'currency8',
      image: 'image4',
      additionalProperties: {
        'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
      },
    },
    {
      id: 'id2',
      title: 'title2',
      price: 'price0',
      currency: 'currency8',
      image: 'image4',
      additionalProperties: {
        'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
      },
    }
  ],
  additionalProperties: {
    'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
  },
};
```

