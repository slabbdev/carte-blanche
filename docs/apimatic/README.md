# Carte Blanche × APIMatic — from spec to agents

## The pipeline today (running)

`npm run apimatic:sync` (`scripts/apimatic-sync.ts`) drives APIMatic's API with
our key (`X-Auth-Key` header, vendor content-types):

1. **Validate** `docs/openapi.json` — `validation: OK, linting: OK` (agentic-tools ruleset)
2. **Generate** the TypeScript SDK (`POST /code-generations/generate-via-url`, template `TS_GENERIC_LIB`)
3. **Download + commit** it at `sdk/typescript/` (`carte-blanche-apilib`)

The contract is therefore consumed by APIMatic's own pipeline — validated,
linted, and packaged by the sponsor before any human reads it.

## APIMatic v2 is already agent-native (from their own docs, vendored in
`.agents/skills/apimatic-portal/references/`)

- Every portal page is served as **Markdown at `<url>.md`**; the whole portal
  is summarized at `/llms.txt` and `/llms-full.txt` (generated, not hand-written)
- **Context Plugins** — `apimatic plugin generate` produces a plugin that hands
  AI coding assistants (Claude Code, Cursor, VS Code) the full API reference,
  auth details, versioned SDK code, workflows, and per-language skills
- `src/apimatic.json` scaffold with our plugin block sits at
  `docs/apimatic/portal/src/apimatic.json`

## The two steps that need the account (user-side)

```bash
apimatic auth login                 # APIMatic CLI (account-side once)
apimatic plugin generate            # builds the Carte Blanche Context Plugin
apimatic portal serve               # local preview, then host/publish
```

Plus: connect the workspace so `https://carte-blanche.docs.apimatic.io` (or
equivalent) hosts the portal — the pending item from day one.

## The proposal to APIMatic — the missing piece is RUNTIME, not docs

Their Context Plugins serve the **integration-time** assistant (a developer
wiring the SDK). The missing generation: **an MCP server emitted next to the
SDK**. Every APIMatic customer's spec could yield, in one pipeline:

> spec → SDK (per language) + developer portal + **MCP server**
> (tools per operation, auth from the spec's security schemes)

Then ChatGPT/Claude/any agent doesn't just *read about* the API — it can
*call* it, with APIMatic-generated correctness (typed params from the spec).

Carte Blanche hands them the reference artifact: our hand-written MCP server
(`mcp/server.ts`, 13 tools over this exact API) is precisely what such a
generator would emit — proof the pattern works on a real, money-moving,
evidence-sealing API. A generator prototype lives at
`scripts/apimatic-mcp-gen.mjs`.
