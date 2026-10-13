
# Denial

*This model accepts additional fields of type unknown.*

## Structure

`Denial`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `denialId` | `string \| undefined` | Optional | - |
| `mandateId` | `string \| undefined` | Optional | - |
| `reasonCode` | `string \| undefined` | Optional | - |
| `reasonDetail` | `string \| undefined` | Optional | - |
| `chainTip` | `string \| undefined` | Optional | - |
| `journalLength` | `number \| undefined` | Optional | - |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { Denial } from 'carte-blanche-apilib';

const denial: Denial = {
  denialId: 'denialId6',
  mandateId: 'mandateId8',
  reasonCode: 'reasonCode0',
  reasonDetail: 'reasonDetail2',
  chainTip: 'chainTip4',
  additionalProperties: {
    'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
  },
};
```

