
# Purchase Outcome

*This model accepts additional fields of type unknown.*

## Structure

`PurchaseOutcome`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `outcome` | [`Outcome \| undefined`](../../doc/models/outcome.md) | Optional | - |
| `receipt` | `unknown \| undefined` | Optional | - |
| `inclusion` | `unknown \| undefined` | Optional | Merkle inclusion proof against the signed tree head |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { Outcome, PurchaseOutcome } from 'carte-blanche-apilib';

const purchaseOutcome: PurchaseOutcome = {
  outcome: Outcome.Receipt,
  receipt: { 'key1': 'val1', 'key2': 'val2' },
  inclusion: { 'key1': 'val1', 'key2': 'val2' },
  additionalProperties: {
    'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
  },
};
```

