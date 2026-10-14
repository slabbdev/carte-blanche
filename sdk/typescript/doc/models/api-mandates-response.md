
# Api Mandates Response

*This model accepts additional fields of type unknown.*

## Structure

`ApiMandatesResponse`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `mandates` | [`SignedMandate[] \| undefined`](../../doc/models/signed-mandate.md) | Optional | - |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { ApiMandatesResponse } from 'carte-blanche-apilib';

const apiMandatesResponse: ApiMandatesResponse = {
  mandates: [
    {
      mandate: { 'key1': 'val1', 'key2': 'val2' },
      signature: 'signature2',
      publicKey: 'publicKey2',
      additionalProperties: {
        'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
      },
    },
    {
      mandate: { 'key1': 'val1', 'key2': 'val2' },
      signature: 'signature2',
      publicKey: 'publicKey2',
      additionalProperties: {
        'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
      },
    },
    {
      mandate: { 'key1': 'val1', 'key2': 'val2' },
      signature: 'signature2',
      publicKey: 'publicKey2',
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

