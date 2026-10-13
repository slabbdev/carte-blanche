
# Chain Verification

*This model accepts additional fields of type unknown.*

## Structure

`ChainVerification`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `ok` | `boolean \| undefined` | Optional | - |
| `length` | `number \| undefined` | Optional | - |
| `tip` | `string \| undefined` | Optional | - |
| `brokenAt` | `number \| undefined` | Optional | Present when tampering is detected |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { ChainVerification } from 'carte-blanche-apilib';

const chainVerification: ChainVerification = {
  ok: false,
  length: 252,
  tip: 'tip4',
  brokenAt: 28,
  additionalProperties: {
    'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
  },
};
```

