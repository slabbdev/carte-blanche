# Agent

The agent-facing purchase path (mandate check, execution, receipt)

```ts
const agentApi = new AgentApi(client);
```

## Class Name

`AgentApi`

## Methods

* [Attempt Purchase](../../doc/controllers/agent.md#attempt-purchase)
* [Resume Purchase](../../doc/controllers/agent.md#resume-purchase)


# Attempt Purchase

The exact call an LLM agent's purchase() tool makes. Checks the mandate (amount, currency, payee, window, cumulative cap), executes with a deterministic PayPal-Request-Id, journals every step, and answers with a signed receipt — or a signed refusal with the precise reason. Wallet-funded orders stop at PAYER_ACTION_REQUIRED and return the buyer approval redirect (two-phase, human-in-the-loop).

```ts
async attemptPurchase(
  body: PurchaseRequest,
  requestOptions?: RequestOptions
): Promise<ApiResponse<PurchaseOutcome3>>
```

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `body` | [`PurchaseRequest`](../../doc/models/purchase-request.md) | Body, Required | - |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: Receipt (captured), refusal (checked and stopped) or pending (awaiting buyer approval)

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type `PurchaseOutcome3`.

## Example Usage

```ts
const body: PurchaseRequest = {
  mandateId: 'cbmd-639347ac-5406-4ee7-9d47-c14b5d081227',
  amount: '15.00',
  currency: 'USD',
  description: 'office coffee, 1kg',
  funding: Funding.Card,
};

try {
  const response = await agentApi.attemptPurchase(body);

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
    if (error instanceof CustomError) {
      console.log(error.result);
    }
  }
}
```

## Example Response

```
{
  "outcome": "receipt",
  "receiptId": "rcpt-b4405a3bb34dc4d5",
  "orderId": "08M580282K766080S",
  "captureId": "2MU190003X6394442",
  "status": "COMPLETED",
  "amount": "15.00",
  "currency": "USD",
  "chainTip": "277b3550…"
}
```

## Errors

| HTTP Status Code | Error Description | Exception Class |
|  --- | --- | --- |
| 400 | Malformed request | [`CustomError`](../../doc/models/custom-error.md) |


# Resume Purchase

Replays the capture with the same deterministic PayPal-Request-Id (idempotent), journals the capture and issues the receipt.

```ts
async resumePurchase(
  body: ApiAgentPurchaseResumeRequest,
  requestOptions?: RequestOptions
): Promise<ApiResponse<PurchaseOutcome3>>
```

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `body` | [`ApiAgentPurchaseResumeRequest`](../../doc/models/api-agent-purchase-resume-request.md) | Body, Required | - |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: Receipt issued

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type `PurchaseOutcome3`.

## Example Usage

```ts
const body: ApiAgentPurchaseResumeRequest = {
  logicalKey: 'logical_key0',
};

try {
  const response = await agentApi.resumePurchase(body);

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
  }
}
```

## Errors

| HTTP Status Code | Error Description | Exception Class |
|  --- | --- | --- |
| 409 | Buyer has not approved yet, or no pending order for that key | `ApiError` |

