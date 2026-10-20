import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const transport = new StdioClientTransport({
  command: "node",
  args: ["node_modules/@paypal/mcp/dist/index.js", "--tools=all"],
  env: { ...process.env as Record<string,string>, PAYPAL_ACCESS_TOKEN: process.env.TOKEN!, PAYPAL_ENVIRONMENT: "SANDBOX" },
  stderr: "pipe",
});
const client = new Client({ name: "cb-probe", version: "0" });
await client.connect(transport);
const { tools } = await client.listTools();
console.log("TOOLS", tools.length, tools.map(t => t.name).join(" "));
for (const t of tools) if (["create_order","pay_order","create_refund","create_invoice","send_invoice","create_subscription"].includes(t.name)) {
  console.log("\n### " + t.name + " — " + (t.description ?? "").slice(0, 160));
  console.log(JSON.stringify(t.inputSchema).slice(0, 1500));
}
await client.close();
