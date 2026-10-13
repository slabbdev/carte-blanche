
# Signed Mandate

*This model accepts additional fields of type unknown.*

## Structure

`SignedMandate`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `mandate` | `unknown \| undefined` | Optional | - |
| `signature` | `string \| undefined` | Optional | Ed25519 over the canonical JSON of the mandate |
| `publicKey` | `string \| undefined` | Optional | Base64 SPKI of the custodial principal key |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { SignedMandate } from 'carte-blanche-apilib';

const signedMandate: SignedMandate = {
  mandate: { 'key1': 'val1', 'key2': 'val2' },
  signature: 'signature2',
  publicKey: 'publicKey2',
  additionalProperties: {
    'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
  },
};
```

