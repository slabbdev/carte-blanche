
# Receipt

*This model accepts additional fields of type unknown.*

## Structure

`Receipt`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `receiptId` | `string \| undefined` | Optional | - |
| `mandateId` | `string \| undefined` | Optional | - |
| `logicalKey` | `string \| undefined` | Optional | - |
| `createdAt` | `string \| undefined` | Optional | - |
| `amount` | `string \| undefined` | Optional | - |
| `currency` | `string \| undefined` | Optional | - |
| `description` | `string \| undefined` | Optional | - |
| `orderId` | `string \| undefined` | Optional | - |
| `captureId` | `string \| undefined` | Optional | - |
| `status` | `string \| undefined` | Optional | - |
| `chainTip` | `string \| undefined` | Optional | - |
| `journalLength` | `number \| undefined` | Optional | - |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { Receipt } from 'carte-blanche-apilib';

const receipt: Receipt = {
  receiptId: 'receiptId4',
  mandateId: 'mandateId4',
  logicalKey: 'logicalKey0',
  createdAt: '2016-03-13T12:52:32.123Z',
  amount: 'amount6',
  additionalProperties: {
    'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
  },
};
```

