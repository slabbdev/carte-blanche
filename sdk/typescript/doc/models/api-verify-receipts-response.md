
# Api Verify Receipts Response

*This model accepts additional fields of type unknown.*

## Structure

`ApiVerifyReceiptsResponse`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `report` | [`VerificationReport \| undefined`](../../doc/models/verification-report.md) | Optional | - |
| `chain` | [`ChainVerification \| undefined`](../../doc/models/chain-verification.md) | Optional | - |
| `full` | `unknown \| undefined` | Optional | The full bundle: receipt, mandate, signatures, raw events, Merkle inclusion proof, TSA anchor |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { ApiVerifyReceiptsResponse, Subject } from 'carte-blanche-apilib';

const apiVerifyReceiptsResponse: ApiVerifyReceiptsResponse = {
  report: {
    subject: Subject.Receipt,
    id: 'id4',
    overall: false,
    checks: [
      {
        id: 'id0',
        label: 'label0',
        ok: false,
        detail: 'detail6',
        additionalProperties: {
          'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
        },
      },
      {
        id: 'id0',
        label: 'label0',
        ok: false,
        detail: 'detail6',
        additionalProperties: {
          'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
        },
      },
      {
        id: 'id0',
        label: 'label0',
        ok: false,
        detail: 'detail6',
        additionalProperties: {
          'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
        },
      }
    ],
    additionalProperties: {
      'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
    },
  },
  chain: {
    ok: false,
    length: 112,
    tip: 'tip6',
    brokenAt: 80,
    additionalProperties: {
      'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
    },
  },
  full: { 'key1': 'val1', 'key2': 'val2' },
  additionalProperties: {
    'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
  },
};
```

