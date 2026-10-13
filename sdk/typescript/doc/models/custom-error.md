
# Custom Error

*This model accepts additional fields of type unknown.*

## Structure

`CustomError`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `error` | `string \| undefined` | Optional | - |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
try {
  // make the API call
} catch (error) {
  if (error instanceof CustomError) {
    console.log(error.result);
  }
}
```

