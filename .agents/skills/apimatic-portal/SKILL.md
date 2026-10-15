---
name: apimatic-portal
description: Use when a user wants to build, generate, configure, customize, preview, host, or publish an APIMatic developer portal with the APIMatic CLI. Also use when the user asks about src/apimatic.json, portal branding (logo, favicon, primary color, light/dark mode), header links, navigation tabs and nav.json, Markdown/MDX guide pages, SDK pages in the portal, AI page actions, Context Plugins, LLMs.txt, sitemaps, deploying the static portal, or upgrading a portal project from APIMATIC-BUILD.json.
---

# APIMatic Portal

Guide a user from zero to a running local developer portal, then help them customize and ship it. The skill body IS the instructions — run each command directly; do not ask the user to run CLI commands unless explicitly noted.

This skill targets **APIMatic CLI v2** (`@apimatic/cli@beta`), documented at https://docs.apimatic.io/v4. In v2 the portal is built on the user's machine from a `src/` directory and configured with `src/apimatic.json`.

## When to Use

- User wants to create, serve, build, or deploy an APIMatic developer portal
- User asks to change the portal's name, logo, favicon, colors, color mode, header links, AI page actions, pages, sidebar order, or tabs
- User wants SDK pages or a Context Plugin page in their portal
- User has a `src/apimatic.json` or is setting one up
- User has an older project with `src/APIMATIC-BUILD.json` and wants to upgrade it

**When NOT to use:** Non-APIMatic portals (Docusaurus, ReadMe, etc.). SDK generation, customization, or publishing on its own belongs to the `apimatic-sdk` skill.

## Red Flags — STOP and re-read the relevant section

- About to `cd src/` before running a portal command → commands run from the project root (the directory that *contains* `src/`), never from inside `src/`
- About to add portal settings to `APIMATIC-BUILD.json`, or create `toc.yml` → CLI v2 ignores both for portals; use `src/apimatic.json` and `nav.json` (see `references/upgrading-from-v1.md` for existing projects)
- About to add a key to the `portal` block that is not listed in `references/apimatic-json.md` (e.g. `theme`, `fonts`, `copilot`, `headIncludes`, `recipes`, `indexable`) → the `portal` block rejects unknown properties and the build fails. Tell the user the feature is not available in this CLI version instead of inventing a key
- About to run `apimatic portal toc new`, `apimatic portal recipe new`, or `apimatic portal copilot` → these commands were removed in CLI v2
- About to create a page without front matter, or with no `title` in it → every page in `src/content/` must start with front matter that includes `title`
- About to write `.md` or `.mdx` extensions in `nav.json`, or a nested path like `guides/intro` → entries are bare file or folder names from the same directory; each folder orders its own pages with its own `nav.json`
- About to make a folder, the SDKs, the API Reference, or the Context Plugin a tab by listing it in `pages` → only the `tabs` list in `src/content/nav.json` makes tabs; `pages` puts it in Home's sidebar (see `references/content-and-navigation.md`)
- The CLI warns that `src/content/nav.json` has no `tabs`, so nothing is a tab → add the `"tabs": [...]` line it prints to keep a tab bar (or `"tabs": []` if the user wants a single sidebar). Projects created before CLI 2.0.0-beta.3 need this
- About to put a page at `src/content/sdks/...`, `src/content/context-plugin/...`, or `src/content/oauth/callback.md` → those addresses are reserved for pages the portal generates
- About to use a language key other than `csharp`, `python`, or `typescript` in `languages` → only these three are available
- About to leave the `languages` block empty or remove it → a portal needs at least one SDK language
- About to reference a logo or favicon outside `src/static/` (e.g. `images/logo.png`) → paths are written relative to `src` and must start with `static/`
- About to add a page, add a language, add a `plugin` block, create `src/static/`, change which files are in `src/spec/`, or change the path in `portal.site.url` while the preview is running, and then just wait for the browser to refresh → these changes need the preview **restarted** (see Portal Configuration)
- About to edit, create, or delete any file inside `src/` during first-time setup before the first portal preview → do not modify the scaffolded `src/` directory except for replacing the sample spec with the user's spec. Start the portal first, then make changes if the user asks.

## Communication Guidelines

This skill is used by developers of all experience levels. All messages shown to the user must be clear, non-technical, and action-oriented. Follow these rules in every response:

- **Never expose internal details:** Do not mention PIDs, process IDs, exit codes, signal names (SIGTERM, SIGKILL, EPIPE), file paths to skill scripts, PID files, heartbeat files, or log files. These are implementation details the user does not need.
- **Never forward raw CLI output:** Do not paste or quote terminal output, spinner characters, ANSI escape codes, or build logs. Summarize what happened in plain language.
- **Translate technical states into plain language:**
  - Instead of "Process 56078 is no longer running" → "The portal server is not running."
  - Instead of "Server process exited (code 1) before becoming ready" → "The portal server failed to start."
  - Instead of "Port 23513 is already in use" → "The default port was taken, so the portal is using a different one."
  - Instead of "Cleaning stale PID file" → say nothing; this is an internal cleanup detail.
- **Use the verbatim blocks provided:** When this skill provides a specific message to show (like the Server Briefing), output it exactly as written, substituting only the real URL. Do not paraphrase or add technical context around it.
- **Keep error guidance actionable:** When something fails, tell the user what went wrong in simple terms and what they can do about it. Do not describe the internal recovery steps you are attempting — just attempt them silently and report the outcome.
- **When in doubt, less is more:** If you are unsure whether a detail is useful to the user, leave it out.

---

## After Completing a Change

After completing any configuration change and confirming it works in the portal, ask the user:

"What would you like to work on next?"

Then suggest the next item from this list, cycling forward from whatever was just completed:

| Order | Feature | Recommendation |
|-------|---------|----------------|
| 1 | Branding | "Make the portal yours — add your logo, favicon, brand color, and choose light, dark, or both modes." |
| 2 | Custom pages | "Add guides, tutorials, or any other Markdown pages your developers need." |
| 3 | Navigation | "Organize your sidebar and tabs, and add links to the portal header." |
| 4 | Context Plugin | "Add a Context Plugin page so developers can give their AI coding assistants accurate knowledge of your API." |

**Rules:**
- Always cycle forward — after item 4, wrap to item 1
- Use the exact recommendation text from the table above
- If the user asks for something specific, do that instead — the recommendation is just a suggestion
- Do not recommend the feature that was just completed
- Only apply after configuration changes, not during first-time setup

---

## Prerequisites

Confirm these are in place before starting:

- Node.js 24 or later and npm installed (`node --version` must print v24 or higher). CLI v2 refuses to run on older Node versions, even though npm lets the install finish.
- An APIMatic account with portal generation enabled (free trial available at app.apimatic.io)
- APIMatic CLI v2 installed globally:

```
npm install -g @apimatic/cli@beta
```

  Always keep the `@beta` tag in every install or reinstall command you run or suggest. Without it, npm resolves the package to CLI v1: `@apimatic/cli` and `@apimatic/cli@latest` both still point to v1. If the user says they installed the CLI without `@beta`, tell them that installed CLI v1 (or nothing), not the v2 this portal needs.

- Verify the CLI is available and on v2:

```
apimatic --version
```

The output should start with `@apimatic/cli/2.`. If the command fails, the CLI v2 is not installed — run the `@beta` install command above. Do not continue to authentication or portal generation until `apimatic --version` prints `@apimatic/cli/2.`.

If it shows `1.x`, CLI v1 is installed. Before upgrading, tell the user (substituting the version it printed):

> "You have APIMatic CLI v1 (`<version>`) installed, and this portal needs CLI v2. I'm upgrading your APIMatic CLI to v2 now with `npm install -g @apimatic/cli@beta`. This replaces v1 on this machine; to switch back later, run `npm install -g @apimatic/cli@1`."

Then run the install command and check `apimatic --version` again.

## Step 1: Authenticate with APIMatic

First check whether the user is already signed in:

```
apimatic auth status
```

If the output shows an account email, skip to Step 2.

**Primary flow (browser-based):**

Run the auth launcher script from the project directory. It spawns `apimatic auth login` as a detached process so the terminal does not block:

```
node {skill_dir}/scripts/auth-login.mjs
```

Where `{skill_dir}` is the absolute path to the directory containing this skill file.

The script launches the browser sign-in flow and immediately returns. Relay the following message to the user: "A browser window has opened. Complete sign-in in the browser, then confirm here when done."

Wait for the user to confirm sign-in is complete before proceeding.

After confirmation, verify auth succeeded:

```
apimatic auth status
```

The output should show the account email and the SDK languages available on the plan. If it does not, authentication did not complete — try the fallback below.

**Fallback flow (API key):**

Use this when browser auth is not available (CI environment, headless system) or when the user prefers a key-based approach.

Option 1 — CLI flag:

```
apimatic auth login --auth-key=YOUR_API_KEY
```

Option 2 — pass the key to each command with `--auth-key=YOUR_API_KEY` (supported by `portal serve` and `portal generate`).

API keys are generated at: APIMatic Dashboard > Account > API Keys.

**If both methods fail:**

Stop the workflow. Tell the user:

"Authentication failed. Check that your APIMatic account is active, your API key is correct, and you have internet access to apimatic.io. If using browser login, try the --auth-key fallback instead."

Do not proceed past this point until authentication is confirmed.

## Step 2: Determine setup path and get spec location

If you do not know whether the user is starting from scratch or has an existing project, ask:

1. "Do you already have an APIMatic portal project directory with a `src/` folder, or are you starting from scratch?"
   - **No `src/` yet (new project) → follow Path A**
   - **`src/` exists and contains `apimatic.json` → follow Path B**
   - **`src/` exists but has `APIMATIC-BUILD.json` and no `apimatic.json` → it is a CLI v1 project. Read `references/upgrading-from-v1.md` and follow it, then continue with Path B**

2. If following Path A, ask: "What is the path to your API specification file? (OpenAPI JSON/YAML, Swagger, Postman collection, or another format APIMatic can convert)"

Store the spec path. You will need it to bootstrap the portal. A portal reads **OpenAPI 3.x only** — a spec in any other format is converted with `apimatic api transform` during setup (see `references/first-time-setup.md`, Step A5).

---

## Path A: First-Time Setup (Guided Onboarding)

Read `references/first-time-setup.md` and follow every step in order. Do not skip steps or summarize — execute each step exactly as written.

The CLI also has an interactive wizard, `apimatic quickstart`, but it prompts in the terminal and cannot be driven by an agent. Use the scripted setup in `references/first-time-setup.md`. Only mention `apimatic quickstart` if the user asks for a wizard they can run themselves. In a directory whose `src/spec/` already holds files, `apimatic quickstart` needs an existing `src/apimatic.json` and only adds what is missing; in an empty directory it writes one.

---

## Path B: Subsequent Local Development

Use this path when a v2 project (`src/apimatic.json`) already exists.

### Step 3B: Navigate to the project root

The project root is the directory that contains the `src/` folder — not inside `src/` itself.

```
cd your-project-directory
```

### Step 4B: Start the local preview server

First check whether a server is already running from a previous session:

```
node {skill_dir}/scripts/serve.mjs status --input ./
```

If this project's server is running (`Running for <project root>`), ask the user whether to reuse it or restart it — do not blindly start a second instance. A `Note: a preview of a different project` line is about another project: never show its URL for this one, and leave it running unless the user asks to stop it.

If no server is running for this project, start it:

```
node {skill_dir}/scripts/serve.mjs start --input ./
```

Where `{skill_dir}` is the absolute path to the directory containing this skill file, and `--input` is the project root (the directory containing `src/`). Every `serve.mjs` command acts only on the preview of the project `--input` names (it defaults to the current directory), so pass the same project root to each one.

The script spawns `apimatic portal serve` and streams its output live. The first start downloads the generated SDKs and code samples and can take a minute or two. The script exits automatically once the line `The portal is running at <url>` appears. The CLI's default port is 23513; if it is taken, the CLI picks another free port on its own, so always use the URL the script reports. Surface that URL to the user and append the shutdown reminder at the end of this response and every subsequent response while the server is running:

"Your portal is running at <url>"

> Portal server is running. It will stop automatically after 30 minutes of inactivity. To stop it now, tell me: **"shut down the portal"**

**Additional serve subcommands:**

| Command | What it does |
|---------|--------------|
| `node {skill_dir}/scripts/serve.mjs status --input ./` | Check whether the server is running and show recent output |
| `node {skill_dir}/scripts/serve.mjs watch --input ./` | After an edit, wait briefly and report whether the preview accepted it |
| `node {skill_dir}/scripts/serve.mjs restart --input ./` | Stop and start the server (needed after some edits — see Portal Configuration) |
| `node {skill_dir}/scripts/serve.mjs stop --input ./` | Stop the server |

**If portal serve fails:**

1. **Not signed in:** The CLI says you need to be signed in to generate a portal. Go back to Step 1.
2. **Node.js too old:** The CLI refuses to run and names the Node version it found. Tell the user: "The APIMatic CLI needs Node.js 24 or later. Please install it from https://nodejs.org/en/download/ then come back."
3. **Missing or invalid spec:** Check that `src/spec/` contains the API spec file. If the CLI says `No OpenAPI 3.x document found`, the spec is in another format (Swagger 2.0, Postman, …): run the `apimatic api transform` command it prints, move the converted file up into `src/spec/` as it says, and delete the original and the `transformations/` folder. If the CLI reports problems with the spec, run `apimatic api validate` from the project root (it checks the definition in `src/spec/`) and explain the errors to the user.
4. **Problems in `apimatic.json`, a page, or a `nav.json`:** The CLI lists each problem with the file it is in. Fix each one using `references/apimatic-json.md` and `references/content-and-navigation.md`, then retry.
5. **`apimatic` command not found:** Run `npm install -g @apimatic/cli@beta` (always with `@beta`; without it npm installs CLI v1) and verify with `apimatic --version`, then retry. 
6. **Permission error or script cannot run:** If the error cannot be resolved automatically, tell the user:

   > "I was unable to start the portal server automatically due to a permissions or environment issue. To start it manually, run this command in your project root (the directory that contains `src/`):
   >
   > `apimatic portal serve --open`
   >
   > Once you see a line like `The portal is running at http://localhost:23513`, come back here and tell me the server is running."

   Then ask the user: "Is the server running? What URL do you see? (or tell me if you got an error)"

7. **Any other error:** Read the exact error message from the CLI output. Do not retry automatically — diagnose the specific error first.

---

## Build and Host the Portal

`apimatic portal generate` builds the portal as a folder of static files (HTML, CSS, JavaScript, and assets) that can be hosted anywhere. Run it from the project root:

```
apimatic portal generate --destination=./portal
```

| Flag | What it does |
|------|--------------|
| `-i, --input` | Path to the directory that contains `src`. Defaults to `./`. |
| `-d, --destination` | Where to write the portal. Defaults to `<input>/portal`. |
| `-f, --force` | Overwrite a previous build in the destination without asking. Use for repeated builds. |
| `--zip` | Write the portal as a `.zip` archive instead of a folder. |
| `-k, --auth-key` | Authenticate with an API key instead of the signed-in session. |

**Deploying:** Upload the destination folder to any static host that serves files over HTTPS — Netlify, Cloudflare Pages, Vercel, Azure Static Web Apps or Blob Storage, AWS S3 behind CloudFront, or GitHub Pages. Point unknown paths at `404.html`; nothing else needs configuring. Set the production address in `portal.site.url` in `src/apimatic.json` (e.g. `https://docs.example.com`) — this adds canonical links and absolute sitemap URLs for search engines.

### Hosting under a path

To host the portal under a path of a site (e.g. `https://example.com/docs`) instead of on its own domain, put the full address, path included, in `portal.site.url` and rebuild. The build then serves every page, asset, `sitemap.xml`, and `llms.txt` under that path. Keep writing page links and header links as `/guides/quickstart` — the build adds the path. Then tell the user:

- Upload the build so its contents are served at that path (for example, into a `docs/` folder at the host's root).
- Serve `404.html` for missing pages under the path, so deep links resolve.
- No `robots.txt` is generated, because crawlers read it only at the root of a host. If they control the root, add `Sitemap: https://example.com/docs/sitemap.xml` to its `robots.txt`.
- To check the build locally, serve it under the same path; served from the root of a local server, its pages load without styles and scripts.

The preview uses the path too (e.g. `http://localhost:23513/docs/`), so always use the URL `serve.mjs` reports. Changing the path needs the preview restarted.

### OAuth sign-in in the API playground

If the API uses OAuth 2 sign-in, every endpoint page in the playground returns to one page: `/oauth/callback` under the portal's address. Tell the user to register that redirect URI with their OAuth provider — e.g. `https://docs.example.com/oauth/callback`, or `https://example.com/docs/oauth/callback` when the portal is hosted under a path. Until they do, the provider refuses the sign-in. Portals built before CLI 2.0.0-beta.5 used each endpoint page's address instead, so this changes after an upgrade.

**CI/CD:** Regenerate and redeploy whenever the API definition or guides change. In CI, use Node 24 and sign in with an API key stored as a secret, not a browser session:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "24"
- run: npx @apimatic/cli@beta portal generate --auth-key="${{ secrets.APIMATIC_API_KEY }}" --destination=./portal --force
```

Then deploy `./portal` with the host's CLI or Git integration. A complete sample workflow is in the `v2` branch of github.com/apimatic/sample-docs-as-code-portal (`.github/workflows/DeployStaticPortal.yml`).

---

## Quick Reference

| Task | Command / Location |
|------|-------------------|
| First-time setup | Download the v2 sample `src/` — see [Path A](#path-a-first-time-setup-guided-onboarding) |
| Start local preview | `node {skill_dir}/scripts/serve.mjs start --input ./` |
| Server status / restart / stop | `node {skill_dir}/scripts/serve.mjs status` / `restart` / `stop`, each with `--input ./` |
| Build for hosting / CI | `apimatic portal generate --destination=./portal --auth-key=KEY` |
| Portal name, address, description | `portal.site` in `src/apimatic.json` |
| Logo, favicon, primary color, light/dark mode | `portal.brand` in `src/apimatic.json` |
| Header links | `portal.navigation.links` in `src/apimatic.json` |
| "Open in AI assistant" page actions | `portal.ai.pageActions` in `src/apimatic.json` |
| SDK languages shown in the portal | `languages` in `src/apimatic.json` (`csharp`, `python`, `typescript`) |
| Custom page | `.md` or `.mdx` file with `title` front matter in `src/content/` |
| Sidebar order, folder titles | `nav.json` in each folder of `src/content/` |
| Tabs | `tabs` in `src/content/nav.json` |
| Host under a path (e.g. `/docs`) | `portal.site.url` → full address with the path — see [Hosting under a path](#hosting-under-a-path) |
| OAuth redirect URI for the playground | `<portal address>/oauth/callback` |
| Images for pages | `src/static/` (written as `/images/x.png` in pages) |
| Context Plugin page | `plugin` block (via `apimatic plugin generate`) or `portal.pluginUrl` |
| LLMs.txt, sitemap, robots.txt | Generated automatically; set `portal.site.url` for absolute sitemap URLs and canonical links |
| Validate the API spec | `apimatic api validate` (checks `src/spec/`) |

---

## Portal Configuration

After the portal is running (Path A or B), configure it by editing `src/apimatic.json`, the pages in `src/content/`, and the `nav.json` files. Read `references/apimatic-json.md` before editing `apimatic.json`, and `references/content-and-navigation.md` before editing pages or `nav.json`.

**After making any change**, follow this preview protocol:

**Step 1 — Check that the server is running:**

```
node {skill_dir}/scripts/serve.mjs status --input ./
```

- Output starts with `Running for` → this project's server is live. Continue to Step 2.
- A `Note: a preview of a different project` line is about another project's server — it does not mean this project's preview is running.
- Output starts with `No server running` or `Process … is no longer running` → ask the user: "No preview server is running. Would you like me to start it now so you can preview your changes?"
  - User says yes → run `node {skill_dir}/scripts/serve.mjs start --input ./`. Once the URL appears, surface it, append the shutdown reminder, then stop here — a fresh start already includes the change.
  - User says no → skip the rest of this protocol.

**Step 2 — Decide whether the change needs a restart.**

The preview picks up these edits live, within a second or two:
- Changes to the text of existing pages in `src/content/`
- Changes to any `nav.json` (order, titles, tabs)
- Changes to the `portal` block of `apimatic.json`
- Removing a language from `languages`, or removing the `plugin` block

These edits need the preview **restarted**:
- Adding or removing a page in `src/content/`
- Adding a language to `languages`, or adding a `plugin` block
- Creating `src/static/` when it did not exist
- Adding, removing, or replacing files in `src/spec/`
- Changing the path in `portal.site.url`

If the change needs a restart, run `node {skill_dir}/scripts/serve.mjs restart --input ./`, surface the URL, and skip Step 3.

**Step 3 — Confirm the preview accepted the change:**

```
node {skill_dir}/scripts/serve.mjs watch --input ./
```

- Exit code 0 → tell the user: "Your changes are live. Refresh <url> in your browser if it hasn't updated."
- Exit code 2 → the CLI rejected the edit and the preview keeps showing the last version it accepted. The script prints the CLI's explanation. Fix the specific problem, save, and run `watch` again. If the output says the edit needs the preview restarted, run `restart` instead.

Apply this protocol after every configuration change in any sub-section below.

### Portal name, address, and description

Set `portal.site.name`, `portal.site.url`, and `portal.site.description`. By default the portal takes its name and description from the API spec. `site.name` is **required** when `src/spec/` holds more than one spec. `site.url` is the production address — the origin (`https://docs.example.com`) or, when the portal is hosted under a path, the full address (`https://example.com/docs`, see [Hosting under a path](#hosting-under-a-path)). Never `http://localhost:...`.

### Branding: logo, favicon, colors, color mode

Edit `portal.brand`. Put image files in `src/static/` and reference them as `static/...` paths. Colors are `#rgb` or `#rrggbb` hex values. `colorMode` is `"light"`, `"dark"`, or `"both"` (default). Forcing `light` or `dark` hides the theme switch. Only a primary brand color is configurable — there are no settings for fonts, other colors, or custom CSS.

Read `references/apimatic-json.md` for the single-value and `{ light, dark }` forms.

### Header links

Add entries to `portal.navigation.links`. Each link has a `label` and a `url` that is either a portal page starting with `/` (e.g. `/guides/quickstart`) or an external address starting with `https://` or `http://`.

### AI page actions

`portal.ai.pageActions` (default `true`) adds an option on every page to open it in an external AI assistant. Set it to `false` to remove it. The portal also publishes `/llms.txt`, `/llms-full.txt`, and a Markdown version of every page (`<page-url>.md`) automatically — no configuration needed.

### Custom pages and navigation

Create a `.md` or `.mdx` file anywhere under `src/content/` that starts with front matter giving its `title`, then add its file name (without extension) to the `nav.json` in the same folder if that file lists pages explicitly. Restart the preview after adding or removing a page.

Tabs come only from the `tabs` list in `src/content/nav.json`. **Home** is always the first tab and holds `index.md` and everything `tabs` does not name. `tabs` lists the tabs after Home, in order: folders directly under `src/content/`, and the generated sections `apimatic:sdks`, `apimatic:plugin`, and `apimatic:api`. Anything left out of `tabs` — the generated sections included — is a folder in Home's sidebar. Without a `tabs` key there is no tab bar, and the CLI warns about it.

```json
{
  "tabs": ["guides", "apimatic:sdks", "apimatic:api"],
  "pages": ["index", "..."]
}
```

Read `references/content-and-navigation.md` for front matter, `nav.json` rules, tabs, folders, images, links, and the available MDX components (`Callout`, `Cards`/`Card`).

### SDK languages

Each language in the `languages` block (`csharp`, `python`, `typescript`) gets a card on the SDKs page with a download link, a page with its getting-started guide, and code samples on every API reference page. Declare a language with an empty object, e.g. `"python": {}`. Once `apimatic sdk publish` records a release, the card also shows the install command, package, and source repository. Do not hand-write the `publishing` part of a language entry — `apimatic sdk publish` writes it. Restart the preview after adding a language.

### Context Plugins

A Context Plugin gives AI coding assistants (Claude Code, Cursor, VS Code) accurate context about the API and its SDKs. The portal shows a **Context Plugin** page with install instructions (a tab when `apimatic:plugin` is in `tabs`) when `apimatic.json` has a `plugin` block, or a `portal.pluginUrl` for a plugin hosted elsewhere.

Read `references/context-plugins.md` for the publish → generate → publish flow and the `plugin` block.

### Features not available in CLI v2

API Recipes, API Copilot, custom themes and fonts, custom header/footer HTML, `headIncludes`/`tailIncludes`, dynamic configuration scripts, and versioned portals are not part of CLI v2's portal configuration. If the user asks for one, say it is not available in this version of the APIMatic CLI, and offer the closest supported option (for example, a Markdown guide page instead of a recipe, or `portal.brand.colors.primary` instead of a full theme). Never invent configuration keys for them.

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Running `apimatic portal serve` from inside `src/` | Run from the project root (the directory that *contains* `src/`) |
| Installing `@apimatic/cli` or `@apimatic/cli@latest` | Those install CLI v1. Install `@apimatic/cli@beta` |
| Using Node 20 or 22 | CLI v2 needs Node 24 or later, locally and in CI |
| Page has no front matter or no `title` | Start every page with `---\ntitle: Page title\n---` |
| `nav.json` entry has an extension or a path (`"guides/intro.md"`) | Use the bare name of a page or folder in the same directory (`"intro"`) |
| Logo path `images/logo.png` or `/static/logo.png` | Write `static/images/logo.png` (relative to `src`, under `static`) |
| Setting `site.url` to `http://localhost:23513` | Use the production address, e.g. `https://docs.example.com` |
| Hosting under a path (e.g. `/docs`) but leaving it out of `site.url` | Put the full address in `site.url`, e.g. `https://example.com/docs`, and rebuild — otherwise pages load without styles and scripts |
| Listing a folder or `apimatic:sdks` in `pages` to make it a tab | Move it to `tabs` in `src/content/nav.json`; a name cannot be in both lists |
| Adding a page and waiting for live reload | Adding or removing pages needs `serve.mjs restart` |
| Adding `theme`, `copilot`, or other v1 keys to `portal` | The `portal` block rejects unknown properties. The feature is not available in v2 |
| Saving `nav.json` with a UTF-8 byte-order mark | Save as UTF-8 without BOM; the build cannot read a BOM |

---

## Reference Files

- `references/first-time-setup.md` — Path A: Node 24 check, CLI v2 install, sign-in, scaffolding `src/` from the v2 sample portal, first preview, and the Server Briefing.
- `references/apimatic-json.md` — Every `src/apimatic.json` setting: `portal.site` (including hosting under a path), `portal.brand`, `portal.navigation`, `portal.ai`, `portal.pluginUrl`, `languages`, `plugin`, and value formats (static paths, colors, links).
- `references/content-and-navigation.md` — `src/content/` layout, page front matter, `nav.json` (ordering, `...`, titles, `tabs`, generated-section tokens, `(group)` folders), page URLs, images, reserved addresses, and MDX components.
- `references/context-plugins.md` — Generating and publishing a Context Plugin, the `plugin` block, and `pluginUrl`.
- `references/upgrading-from-v1.md` — Moving a CLI v1 project (`APIMATIC-BUILD.json`, `toc.yml`) to CLI v2.
- `examples/apimatic.json` — A complete `src/apimatic.json` using every portal setting.
- `examples/content/` — Sample pages and `nav.json` files showing tabs, folders, front matter, and MDX components.

Read the relevant reference file when the user asks about any configuration area.
