
# Verification Report

*This model accepts additional fields of type unknown.*

## Structure

`VerificationReport`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `subject` | [`Subject \| undefined`](../../doc/models/subject.md) | Optional | - |
| `id` | `string \| undefined` | Optional | - |
| `overall` | `boolean \| undefined` | Optional | - |
| `checks` | [`Check[] \| undefined`](../../doc/models/check.md) | Optional | - |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { Subject, VerificationReport } from 'carte-blanche-apilib';

const verificationReport: VerificationReport = {
  subject: Subject.Receipt,
  id: 'id2',
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
    }
  ],
  additionalProperties: {
    'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
  },
};
```

