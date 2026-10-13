
# Purchase Outcome 2

*This model accepts additional fields of type unknown.*

## Structure

`PurchaseOutcome2`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `outcome` | [`Outcome2 \| undefined`](../../doc/models/outcome-2.md) | Optional | - |
| `logicalKey` | `string \| undefined` | Optional | - |
| `orderId` | `string \| undefined` | Optional | - |
| `approvalUrl` | `string \| undefined` | Optional | - |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { Outcome2, PurchaseOutcome2 } from 'carte-blanche-apilib';

const purchaseOutcome2: PurchaseOutcome2 = {
  outcome: Outcome2.Pending,
  logicalKey: 'logicalKey6',
  orderId: 'orderId2',
  approvalUrl: 'approvalUrl4',
  additionalProperties: {
    'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
  },
};
```

