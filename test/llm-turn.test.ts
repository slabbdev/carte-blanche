import { describe, expect, it } from "vitest";
import { toChatMessages, type LlmTurnRequest } from "../src/ai/llmTurn.js";

describe("AG Studio turn → Chat Completions", () => {
  it("puts the instructions first, folds consecutive tool calls into one assistant message, and answers each with a tool message", () => {
    const req: LlmTurnRequest = {
      instructions: "You build dashboards for a PayPal merchant.",
      responseFormat: { type: "text" },
      input: [
        { kind: "input", type: "message", role: "user", content: [{ type: "text", text: "dispute rate vs 1.5 %" }] },
        { kind: "output", type: "function_call", callId: "c1", name: "viewSchema", arguments: "{}" },
        { kind: "output", type: "function_call", callId: "c2", name: "executeQuery", arguments: '{"table":"health"}' },
        { type: "function_call_output", callId: "c1", output: '{"tables":["health"]}' },
        { type: "function_call_output", callId: "c2", output: '{"rows":[{"disputeRatePct":1}]}' },
        { kind: "output", type: "reasoning" },
        { kind: "output", type: "message", role: "assistant", content: [{ type: "text", text: "Adding the tile." }] },
      ],
    };
    const msgs = toChatMessages(req);
    expect(msgs[0]).toEqual({ role: "system", content: "You build dashboards for a PayPal merchant." });
    expect(msgs[1]).toEqual({ role: "user", content: "dispute rate vs 1.5 %" });
    const assistant = msgs[2] as { role: string; tool_calls?: unknown[] };
    expect(assistant.role).toBe("assistant");
    expect(assistant.tool_calls).toHaveLength(2);
    expect(msgs[3]).toEqual({ role: "tool", tool_call_id: "c1", content: '{"tables":["health"]}' });
    expect(msgs[4]).toEqual({ role: "tool", tool_call_id: "c2", content: '{"rows":[{"disputeRatePct":1}]}' });
    // reasoning items carry nothing a chat provider can take back
    expect(msgs[5]).toEqual({ role: "assistant", content: "Adding the tile." });
    expect(msgs).toHaveLength(6);
  });

  it("maps empty tool arguments to a valid JSON object", () => {
    const msgs = toChatMessages({
      responseFormat: { type: "text" },
      input: [{ kind: "output", type: "function_call", callId: "c9", name: "addWidget", arguments: "" }],
    });
    const call = (msgs[0] as { tool_calls: Array<{ function: { arguments: string } }> }).tool_calls[0];
    expect(call.function.arguments).toBe("{}");
  });
});
