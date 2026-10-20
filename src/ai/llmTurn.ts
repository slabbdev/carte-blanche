/**
 * One LLM turn for the AG Studio agents, server-side.
 *
 * AG Studio's harness hands the browser adapter an `AgLlmRequest` (the
 * conversation as Responses-style items, instructions, tool schemas). The key
 * must never reach the browser, so the adapter posts that request here and this
 * module speaks Chat Completions to whatever OpenAI-compatible provider
 * OPENAI_BASE_URL points at — the same path the autopilot uses, so one key
 * powers both the shopping agent and the dashboard agents.
 *
 * Non-streaming on purpose: a turn is a few seconds, the adapter replays the
 * result as AG-UI events, and every provider agrees on this wire format.
 */

interface TextPart { type: "text"; text: string }
interface InputMessage { kind: "input"; type: "message"; role: "user" | "system"; content: Array<TextPart | { type: string }> }
interface OutputMessage { kind: "output"; type: "message"; role: "assistant"; content: Array<TextPart | { type: "refusal"; refusal: string }> }
interface ToolCallItem { kind: "output"; type: "function_call"; callId: string; name: string; arguments: string }
interface ToolResultItem { kind?: "input"; type: "function_call_output"; callId: string; output: string }
interface ReasoningItem { kind: "output"; type: "reasoning" }
type ConversationItem = InputMessage | OutputMessage | ToolCallItem | ToolResultItem | ReasoningItem;

export interface LlmTurnRequest {
  input: ConversationItem[];
  instructions?: string;
  tools?: Array<{ name: string; description: string; parameters: unknown; kind?: string; provider?: unknown }>;
  toolChoice?: "auto" | "none" | "required" | { name: string };
  responseFormat?: { type: "text" } | { type: "json"; name: string; description?: string; schema: unknown };
  model?: { id?: string; effort?: string };
}

export interface LlmTurnResult {
  id: string;
  model: string;
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  finishReason: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

export function llmConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

function textOf(parts: Array<{ type: string; text?: string; refusal?: string }>): string {
  return parts.map((p) => (p.type === "text" ? p.text ?? "" : p.type === "refusal" ? p.refusal ?? "" : "")).join("");
}

/** Responses-style items → Chat Completions messages. Consecutive tool calls fold into one assistant message. */
export function toChatMessages(req: LlmTurnRequest): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (req.instructions) out.push({ role: "system", content: req.instructions });
  for (const item of req.input) {
    if (item.type === "message" && item.kind === "input") {
      out.push({ role: item.role, content: textOf(item.content as TextPart[]) });
    } else if (item.type === "message") {
      out.push({ role: "assistant", content: textOf((item as OutputMessage).content) });
    } else if (item.type === "function_call") {
      const last = out[out.length - 1];
      const call = { id: item.callId, type: "function" as const, function: { name: item.name, arguments: item.arguments || "{}" } };
      if (last && last.role === "assistant" && last.tool_calls) last.tool_calls.push(call);
      else out.push({ role: "assistant", content: null, tool_calls: [call] });
    } else if (item.type === "function_call_output") {
      out.push({ role: "tool", tool_call_id: item.callId, content: item.output });
    }
    // reasoning items carry nothing a chat provider can take back
  }
  return out;
}

function toolChoiceOf(choice: LlmTurnRequest["toolChoice"]): unknown {
  if (!choice) return undefined;
  if (typeof choice === "string") return choice;
  return { type: "function", function: { name: choice.name } };
}

export async function runLlmTurn(req: LlmTurnRequest, signal?: AbortSignal): Promise<LlmTurnResult> {
  const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const model = req.model?.id && req.model.id !== "default" ? req.model.id : process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const messages = toChatMessages(req);
  const tools = (req.tools ?? [])
    .filter((t) => t.kind !== "provided")
    .map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

  const body: Record<string, unknown> = { model, messages };
  if (tools.length) {
    body.tools = tools;
    const choice = toolChoiceOf(req.toolChoice);
    if (choice) body.tool_choice = choice;
  }
  if (req.responseFormat?.type === "json") {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: req.responseFormat.name, description: req.responseFormat.description, schema: req.responseFormat.schema, strict: false },
    };
  }

  let data = await post(base, body, signal);
  if (!data.ok && data.status === 400 && req.responseFormat?.type === "json" && /response_format|json_schema/i.test(data.text)) {
    // providers without json_schema support: json_object + the schema in the instructions
    const schemaHint = `Respond with a single JSON object matching this JSON Schema: ${JSON.stringify(req.responseFormat.schema)}`;
    const fallback: ChatMessage[] = [{ role: "system", content: schemaHint }, ...messages];
    data = await post(base, { ...body, messages: fallback, response_format: { type: "json_object" } }, signal);
  }
  if (!data.ok) throw new Error(`LLM HTTP ${data.status}: ${data.text.slice(0, 300)}`);

  const parsed = JSON.parse(data.text) as {
    id?: string; model?: string;
    choices?: Array<{ finish_reason?: string; message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = parsed.choices?.[0];
  if (!choice?.message) throw new Error("empty LLM response");
  return {
    id: parsed.id ?? `turn-${Date.now()}`,
    model: parsed.model ?? model,
    text: choice.message.content ?? "",
    toolCalls: (choice.message.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments || "{}" })),
    finishReason: choice.finish_reason ?? "stop",
    usage: parsed.usage ? { inputTokens: parsed.usage.prompt_tokens, outputTokens: parsed.usage.completion_tokens } : undefined,
  };
}

async function post(base: string, body: unknown, signal?: AbortSignal): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(90_000),
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}
