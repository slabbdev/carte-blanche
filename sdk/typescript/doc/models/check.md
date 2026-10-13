
# Check

*This model accepts additional fields of type unknown.*

## Structure

`Check`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string \| undefined` | Optional | mandate_signature \| event_hashes \| receipt_matches_events \| receipt_signature \| merkle_inclusion \| tsa_anchor |
| `label` | `string \| undefined` | Optional | - |
| `ok` | `boolean \| undefined` | Optional | - |
| `detail` | `string \| undefined` | Optional | - |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { Check } from 'carte-blanche-apilib';

const check: Check = {
  id: 'id2',
  label: 'label2',
  ok: false,
  detail: 'detail8',
  additionalProperties: {
    'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
  },
};
```

