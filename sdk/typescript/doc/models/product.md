
# Product

*This model accepts additional fields of type unknown.*

## Structure

`Product`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string \| undefined` | Optional | - |
| `title` | `string \| undefined` | Optional | - |
| `price` | `string \| undefined` | Optional | decimal string the mandate will pin |
| `currency` | `string \| undefined` | Optional | - |
| `image` | `string \| undefined` | Optional | - |
| `website` | `string \| undefined` | Optional | - |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { Product } from 'carte-blanche-apilib';

const product: Product = {
  id: 'id0',
  title: 'title6',
  price: 'price2',
  currency: 'currency0',
  image: 'image6',
  additionalProperties: {
    'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
  },
};
```

