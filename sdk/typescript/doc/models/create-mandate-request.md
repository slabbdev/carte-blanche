
# Create Mandate Request

*This model accepts additional fields of type unknown.*

## Structure

`CreateMandateRequest`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `principal` | `string` | Required | Who grants the mandate |
| `agent` | `string` | Required | Who spends under it |
| `purpose` | `string \| undefined` | Optional | - |
| `currency` | `string` | Required | ISO 4217; the mandate's single denomination |
| `maxPerTransaction` | `string` | Required | Decimal amount, e.g. "30.00" |
| `maxTotalSpend` | `string` | Required | - |
| `payees` | `string[] \| undefined` | Optional | Optional allowlist |
| `windowEnd` | `string \| undefined` | Optional | Window opens at issuance |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { CreateMandateRequest } from 'carte-blanche-apilib';

const createMandateRequest: CreateMandateRequest = {
  principal: 'principal0',
  agent: 'agent4',
  currency: 'currency0',
  maxPerTransaction: 'max_per_transaction8',
  maxTotalSpend: 'max_total_spend6',
  purpose: 'purpose6',
  payees: [
    'payees7',
    'payees8'
  ],
  windowEnd: '2016-03-13T12:52:32.123Z',
  additionalProperties: {
    'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
  },
};
```

