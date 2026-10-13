
# Api Agent Purchase Resume Request

*This model accepts additional fields of type unknown.*

## Structure

`ApiAgentPurchaseResumeRequest`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `logicalKey` | `string` | Required | - |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { ApiAgentPurchaseResumeRequest } from 'carte-blanche-apilib';

const apiAgentPurchaseResumeRequest: ApiAgentPurchaseResumeRequest = {
  logicalKey: 'logical_key4',
  additionalProperties: {
    'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
  },
};
```

