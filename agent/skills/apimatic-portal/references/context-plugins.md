# Context Plugins

An APIMatic Context Plugin gives AI coding assistants (Claude Code, Cursor, VS Code) accurate, current context about an API: the full API reference, authentication details, versioned SDK code, integration workflows and code samples, and per-language skills for client setup, calling endpoints, models, errors, configuration, and testing.

The portal shows a **Context Plugin** page with install instructions when `src/apimatic.json` has either:

- a **`plugin` block** — the plugin generated from this project, or
- a **`portal.pluginUrl`** — a plugin that is hosted elsewhere. It must start with `https://`.

Source: https://docs.apimatic.io/v4/generate-context-plugins/context-plugins

---

## Prerequisites

- The plugin references the SDK source repositories on GitHub, so **publish the SDKs with source code first**: `apimatic sdk publish --publish-type=sourcecode` (see the `apimatic-sdk` skill). This also records the languages in `apimatic.json`.
- These commands build plugins for SDKs generated with Codegen v4, the only generator in CLI v2.

---

## Step 1: Record the plugin identity

`apimatic plugin generate` asks for the plugin's ID, display name, and version on its first run, in an interactive prompt the agent cannot answer. To avoid the prompt, ask the user for these values and write them into `src/apimatic.json` first:

```json
"plugin": {
  "pluginId": "acme-payments",
  "pluginName": "Acme Payments",
  "pluginVersion": "0.1.0"
}
```

| Field | Rule |
|-------|------|
| `pluginId` | Lower-case alphanumeric words separated by single dashes |
| `pluginName` | Non-blank display name |
| `pluginVersion` | `major.minor.patch` |

Optional fields: `author` (`name`, `email`), `license`, `homepage`, `repository`, `pluginKey`. See `apimatic-json.md`.

If `apimatic.json` records no languages (no `languages` block), `plugin generate` also asks which languages to include. Make sure the `languages` block lists the published languages before running it.

## Step 2: Generate the plugin

From the project root:

```
apimatic plugin generate
```

| Flag | What it does |
|------|--------------|
| `-i, --input` | Directory that contains `src`. Defaults to `./`. |
| `-d, --destination` | Where to write the plugin. Defaults to `<input>/plugin`. |
| `-f, --force` | Overwrite an existing plugin without asking. |
| `-k, --auth-key` | Authenticate with an API key instead of the signed-in session. |

If the CLI reports that a plugin already exists at the destination, ask the user before re-running with `--force`.

## Step 3: Publish the plugin

```
apimatic plugin publish
```

This **prints** the git commands that publish the plugin to a GitHub repository — it does not run them. Show the commands to the user so they can review what becomes public. Do not run them unless the user explicitly asks you to.

Flags: `-i, --input` and `-d, --destination` (where the plugin was generated, default `<input>/plugin`).

## Step 4: Show it in the portal

- With the `plugin` block in `apimatic.json`, the portal gets a **Context Plugin** page. Restart the preview after adding the block (`serve.mjs restart --input ./`) — the plugin is fetched when the preview starts.
- If the plugin is hosted somewhere else, set `portal.pluginUrl` to its `https://` address instead. The page then installs the plugin from that address; the portal does not carry its own copy.
- To make it a tab, add `"apimatic:plugin"` to `tabs` in `src/content/nav.json`. Otherwise it is a folder in Home's sidebar (see `content-and-navigation.md`).

To remove the page, remove the `plugin` block (applies live) or `pluginUrl`.

---

## Updating the plugin

Bump `pluginVersion` in the `plugin` block, re-run `apimatic plugin generate --force`, then `apimatic plugin publish` and give the user the printed commands again. After publishing new SDK versions, regenerate the plugin so it references the latest SDK code.
