import { AGENT_TOOLS, executeTool } from "./tools.js";

/**
 * Minimal OpenAI-compatible function-calling loop (works with any endpoint that
 * speaks the /chat/completions tool protocol). No SDK dependency: the point of
 * the demo is the mandate boundary, not the framework.
 *
 *   OPENAI_API_KEY=... OPENAI_MODEL=gpt-4o-mini SERVER_URL=http://localhost:8790 \
 *     npm run demo:llm -- "Buy a nice mechanical keyboard for under $60"
 */

const apiKey = process.env.OPENAI_API_KEY;
const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const serverUrl = process.env.SERVER_URL ?? "http://localhost:8790";

const SYSTEM_PROMPT = `You are a shopping agent. A human principal granted you a spending mandate.
Before spending, call mandate_status to learn your limits. Then call purchase for the item requested.
If a purchase is refused, do NOT retry with a modified amount to sneak under a cap: report the refusal honestly.
Always report the receipt or refusal id you received.`;

async function main(): Promise<void> {
  const mandateId = process.argv[2];
  const task = process.argv.slice(3).join(" ") || "Buy a nice mechanical keyboard for under $60";
  if (!mandateId) {
    console.error("usage: npm run demo:llm -- <mandate_id> [task...]");
    console.error("create a mandate first in the console (GET /) or via POST /api/mandates");
    process.exit(1);
  }
  if (!apiKey) {
    console.error("OPENAI_API_KEY is required");
    process.exit(1);
  }

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${task}\n\nYour mandate id: ${mandateId}`,
    },
  ];

  for (let turn = 0; turn < 8; turn++) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, tools: AGENT_TOOLS }),
    });
    if (!res.ok) {
      throw new Error(`LLM call failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as {
      choices: Array<{ message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
    };
    const choice = data.choices[0].message;
    if (choice.content) {
      console.log(`\nagent: ${choice.content}`);
    }
    const calls = choice.tool_calls ?? [];
    if (calls.length === 0) break;
    messages.push(choice as unknown as Record<string, unknown>);
    for (const call of calls) {
      const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
      console.log(`  tool ${call.function.name}(${JSON.stringify(args)})`);
      const result = await executeTool(call.function.name, args, { baseUrl: serverUrl });
      console.log(`    -> ${result.slice(0, 400)}${result.length > 400 ? "…" : ""}`);
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
