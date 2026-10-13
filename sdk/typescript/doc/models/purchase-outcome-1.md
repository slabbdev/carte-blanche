
# Purchase Outcome 1

*This model accepts additional fields of type unknown.*

## Structure

`PurchaseOutcome1`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `outcome` | [`Outcome1 \| undefined`](../../doc/models/outcome-1.md) | Optional | - |
| `reasonCode` | [`ReasonCode \| undefined`](../../doc/models/reason-code.md) | Optional | - |
| `reasonDetail` | `string \| undefined` | Optional | - |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { Outcome1, PurchaseOutcome1, ReasonCode } from 'carte-blanche-apilib';

const purchaseOutcome1: PurchaseOutcome1 = {
  outcome: Outcome1.Denial,
  reasonCode: ReasonCode.MandateNotFound,
  reasonDetail: 'reasonDetail2',
  additionalProperties: {
    'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
  },
};
```

