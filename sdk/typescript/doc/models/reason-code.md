
# Reason Code

## Enumeration

`ReasonCode`

## Fields

| Name |
|  --- |
| `MandateNotFound` |
| `MandateTampered` |
| `MandateRevoked` |
| `WindowNotOpen` |
| `WindowExpired` |
| `CurrencyMismatch` |
| `OverPerTransaction` |
| `OverTotalCap` |
| `PayeeNotAllowed` |
| `InvalidAmount` |

## Example

```ts
import { ReasonCode } from 'carte-blanche-apilib';

const reasonCode = ReasonCode.OverPerTransaction;
```

