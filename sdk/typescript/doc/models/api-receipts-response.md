
# Api Receipts Response

*This model accepts additional fields of type unknown.*

## Structure

`ApiReceiptsResponse`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `receipts` | [`Receipt[] \| undefined`](../../doc/models/receipt.md) | Optional | - |
| `denials` | [`Denial[] \| undefined`](../../doc/models/denial.md) | Optional | - |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { ApiReceiptsResponse } from 'carte-blanche-apilib';

const apiReceiptsResponse: ApiReceiptsResponse = {
  receipts: [
    {
      receiptId: 'receiptId6',
      mandateId: 'mandateId4',
      logicalKey: 'logicalKey0',
      createdAt: '2016-03-13T12:52:32.123Z',
      amount: 'amount6',
      additionalProperties: {
        'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
      },
    },
    {
      receiptId: 'receiptId6',
      mandateId: 'mandateId4',
      logicalKey: 'logicalKey0',
      createdAt: '2016-03-13T12:52:32.123Z',
      amount: 'amount6',
      additionalProperties: {
        'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
      },
    },
    {
      receiptId: 'receiptId6',
      mandateId: 'mandateId4',
      logicalKey: 'logicalKey0',
      createdAt: '2016-03-13T12:52:32.123Z',
      amount: 'amount6',
      additionalProperties: {
        'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
      },
    }
  ],
  denials: [
    {
      denialId: 'denialId8',
      mandateId: 'mandateId0',
      reasonCode: 'reasonCode8',
      reasonDetail: 'reasonDetail4',
      chainTip: 'chainTip6',
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

