
# Health

*This model accepts additional fields of type unknown.*

## Structure

`Health`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `ok` | `boolean \| undefined` | Optional | - |
| `rails` | [`Rails \| undefined`](../../doc/models/rails.md) | Optional | - |
| `journalLength` | `number \| undefined` | Optional | - |
| `catalog` | [`Catalog \| undefined`](../../doc/models/catalog.md) | Optional | - |
| `uptimeSec` | `number \| undefined` | Optional | - |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { Catalog, Health, Rails } from 'carte-blanche-apilib';

const health: Health = {
  ok: false,
  rails: Rails.Live,
  journalLength: 214,
  catalog: Catalog.Channel3,
  uptimeSec: 26,
  additionalProperties: {
    'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
  },
};
```

