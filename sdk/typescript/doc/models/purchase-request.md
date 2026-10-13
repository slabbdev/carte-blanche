
# Purchase Request

*This model accepts additional fields of type unknown.*

## Structure

`PurchaseRequest`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `mandateId` | `string` | Required | - |
| `amount` | `string` | Required | Decimal amount in the mandate's currency |
| `currency` | `string` | Required | - |
| `description` | `string` | Required | - |
| `payee` | `string \| undefined` | Optional | - |
| `logicalKey` | `string \| undefined` | Optional | Business-level idempotency: same key, same outcome, one PayPal side effect |
| `funding` | [`Funding \| undefined`](../../doc/models/funding.md) | Optional | wallet = two-phase with buyer approval |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { Funding, PurchaseRequest } from 'carte-blanche-apilib';

const purchaseRequest: PurchaseRequest = {
  mandateId: 'mandate_id4',
  amount: 'amount0',
  currency: 'currency8',
  description: 'description8',
  payee: 'payee4',
  logicalKey: 'logical_key8',
  funding: Funding.Card,
  additionalProperties: {
    'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
  },
};
```

