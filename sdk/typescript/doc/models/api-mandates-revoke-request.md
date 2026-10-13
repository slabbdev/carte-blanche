
# Api Mandates Revoke Request

*This model accepts additional fields of type unknown.*

## Structure

`ApiMandatesRevokeRequest`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `reason` | `string \| undefined` | Optional | - |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { ApiMandatesRevokeRequest } from 'carte-blanche-apilib';

const apiMandatesRevokeRequest: ApiMandatesRevokeRequest = {
  reason: 'reason4',
  additionalProperties: {
    'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
  },
};
```

