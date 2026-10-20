import path from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * PayPal's official MCP server (`@paypal/mcp`, built on their agent-toolkit),
 * run as a child of this process and driven over stdio MCP.
 *
 * It wants a bearer token (3–8 h in sandbox), so the child is respawned with a
 * fresh one from our own OAuth cache before it can go stale. Nothing else is
 * passed down: the child sees the token and the environment, not our secrets.
 */

export interface UpstreamTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface UpstreamResult {
  text: string;
  json?: unknown;
  isError: boolean;
}

export interface UpstreamLike {
  listTools(): Promise<UpstreamTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<UpstreamResult>;
}

export interface PayPalMcpUpstreamOptions {
  tokenProvider: () => Promise<string>;
  environment: "SANDBOX" | "PRODUCTION";
  /** Path to @paypal/mcp's entry point; resolved from node_modules by default. */
  bin?: string;
  /** Respawn with a fresh token after this long (default 2 h — well inside the token's life). */
  ttlMs?: number;
}

export class PayPalMcpUpstream implements UpstreamLike {
  private client?: Client;
  private startedAt = 0;
  private connecting?: Promise<Client>;

  constructor(private readonly opts: PayPalMcpUpstreamOptions) {}

  static binPath(): string {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve("@paypal/mcp/package.json");
    return path.join(path.dirname(pkg), "dist", "index.js");
  }

  private async connect(): Promise<Client> {
    const ttl = this.opts.ttlMs ?? 2 * 3_600_000;
    if (this.client && Date.now() - this.startedAt < ttl) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      await this.close();
      const token = await this.opts.tokenProvider();
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [this.opts.bin ?? PayPalMcpUpstream.binPath(), "--tools=all"],
        env: {
          PATH: process.env.PATH ?? "",
          PAYPAL_ACCESS_TOKEN: token,
          PAYPAL_ENVIRONMENT: this.opts.environment,
        },
        stderr: "pipe",
      });
      const client = new Client({ name: "carte-blanche-gateway", version: "0.1.0" });
      await client.connect(transport);
      this.client = client;
      this.startedAt = Date.now();
      return client;
    })().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  async listTools(): Promise<UpstreamTool[]> {
    const client = await this.connect();
    const { tools } = await client.listTools();
    return tools.map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<UpstreamResult> {
    const client = await this.connect();
    const res = await client.callTool({ name, arguments: args });
    const parts = (res.content ?? []) as Array<{ type: string; text?: string }>;
    const text = parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      /* the toolkit answers in JSON text, but a plain sentence is a valid answer too */
    }
    return { text, json, isError: Boolean(res.isError) };
  }

  async close(): Promise<void> {
    const c = this.client;
    this.client = undefined;
    if (c) {
      try {
        await c.close();
      } catch {
        /* a dead child is already closed */
      }
    }
  }
}
