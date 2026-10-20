import type {
  AgAiEvent,
  AgAiOutputItem,
  AgLlmAdapter,
  AgLlmExecuteTurnOptions,
  AgLlmRequest,
  AgLlmResponse,
  AgLlmResponseHandler,
} from "ag-studio";

/**
 * The provider boundary for AG Studio's agents, pointed at our own server.
 *
 * Studio hands us the turn (conversation items, instructions, tool schemas);
 * we post it to /api/llm/turn, which holds the key and speaks Chat Completions
 * to any OpenAI-compatible provider. The reply comes back whole and is replayed
 * here as AG-UI events — a text chunk, then one START/ARGS/END triplet per tool
 * call — so the harness executes the tools exactly as with a streaming adapter.
 */

interface TurnResult {
  id: string;
  model: string;
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  finishReason: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export function carteBlancheAdapter(endpoint = "/api/llm/turn"): AgLlmAdapter {
  return {
    executeTurn(request: AgLlmRequest, options?: AgLlmExecuteTurnOptions): AgLlmResponseHandler {
      const turn = fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: options?.signal,
      }).then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = (body as { error?: string; hint?: string });
          throw new Error([detail.error ?? `HTTP ${res.status}`, detail.hint].filter(Boolean).join(" — "));
        }
        return body as TurnResult;
      });

      const stream = {
        async *[Symbol.asyncIterator](): AsyncIterator<AgAiEvent> {
          let result: TurnResult;
          try {
            result = await turn;
          } catch {
            return; // the failure is reported on `complete`
          }
          const messageId = `${result.id}-msg`;
          if (result.text) {
            yield { type: "TEXT_MESSAGE_CHUNK", messageId, role: "assistant", delta: result.text } as AgAiEvent;
          }
          for (const call of result.toolCalls) {
            yield { type: "TOOL_CALL_START", toolCallId: call.id, toolCallName: call.name, parentMessageId: messageId } as AgAiEvent;
            yield { type: "TOOL_CALL_ARGS", toolCallId: call.id, delta: call.arguments } as AgAiEvent;
            yield { type: "TOOL_CALL_END", toolCallId: call.id } as AgAiEvent;
          }
        },
      };

      const complete: Promise<AgLlmResponse> = turn.then(
        (result): AgLlmResponse => {
          const output: AgAiOutputItem[] = [];
          if (result.text) {
            output.push({
              id: `${result.id}-msg`,
              kind: "output",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "text", text: result.text, annotations: [] }],
            });
          }
          for (const call of result.toolCalls) {
            output.push({
              id: `${result.id}-${call.id}`,
              kind: "output",
              type: "function_call",
              callId: call.id,
              name: call.name,
              arguments: call.arguments,
              status: "completed",
            });
          }
          return {
            id: result.id,
            createdAt: Date.now(),
            output,
            status: result.finishReason === "length" ? "incomplete" : "completed",
            ...(result.finishReason === "length" ? { incompleteDetails: { reason: "max_output_tokens" as const } } : {}),
            ...(result.usage ? { usage: { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0 } } : {}),
            model: result.model,
          } as AgLlmResponse;
        },
        (err: Error): AgLlmResponse => ({
          id: `turn-failed-${Date.now()}`,
          createdAt: Date.now(),
          output: [],
          status: "failed",
          error: { code: "llm_turn_failed", message: err.message },
        }),
      );

      return { stream, complete };
    },
  };
}
