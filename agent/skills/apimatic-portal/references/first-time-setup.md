# First-Time Setup: Guided Onboarding (Path A)

Use this path when no build directory (`src/`) exists yet. **You run every command directly** — do not ask the user to run CLI commands unless your attempt fails.

---

## Step A1: Check Node.js

Run `node --version` and read the output.

- v24.x.x or higher → proceed to Step A2
- Lower than v24, or command not found → stop and output exactly: "The APIMatic CLI needs Node.js 24 or later. Please install it from https://nodejs.org/en/download/ then come back." Do not proceed.

---

## Step A2: Install the APIMatic CLI

First run `apimatic --version`. If the output starts with `@apimatic/cli/2.`, CLI v2 is already installed — skip to Step A3.

If the output starts with `@apimatic/cli/1.`, CLI v1 is installed and must be upgraded. Use AskUserQuestion (substituting the version it printed):

```
question: "You have APIMatic CLI v1 (<version>) installed, and this portal needs CLI v2. OK to upgrade it by running: npm install -g @apimatic/cli@beta? This replaces v1 on this machine; you can switch back later with npm install -g @apimatic/cli@1."
options:
  - "Yes, upgrade it"
  - "No, I'll upgrade it myself"
```

- "Yes" → output: "Upgrading your APIMatic CLI to v2 now." Then follow the "Yes" branch below.
- "No" → follow the "No" branch below.

If the command is not found, use AskUserQuestion:

```
question: "APIMatic CLI v2 needs to be installed globally. OK to run: npm install -g @apimatic/cli@beta?"
options:
  - "Yes, go ahead"
  - "No, I'll install it myself"
```

- "Yes" → run `npm install -g @apimatic/cli@beta`, then run `apimatic --version`
  - Output starts with `@apimatic/cli/2.` → proceed to Step A3
  - Command not found or error → do not retry the install with elevated privileges yourself. Stop and output exactly: "The install did not complete. Please run `npm install -g @apimatic/cli@beta` in your own terminal. If npm reports a permissions error (EACCES), follow npm's guide to fix it: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally. Verify with `apimatic --version`, then come back here." Do not proceed.
- "No" → output: "When you're ready, run `npm install -g @apimatic/cli@beta`, verify with `apimatic --version`, and come back here." Do not proceed until the user returns and confirms.

---

## Step A3: Authenticate

Run `apimatic auth status`. If it shows an account email, proceed to Step A4.

Otherwise run `node {skill_dir}/scripts/auth-login.mjs`, which opens the browser sign-in flow without blocking the terminal. `{skill_dir}` is the absolute path to the directory containing this skill's `SKILL.md`.

Because you cannot observe whether the user completed browser sign-in, use AskUserQuestion:

Output first: "A browser window has opened. Please complete sign-in, then come back here."

```
question: "Have you completed sign-in in the browser?"
options:
  - "Yes, I signed in"
  - "No, the browser didn't open"
  - "I got an error"
```

- "Yes" → run `apimatic auth status` and read the output
  - Output contains an email address → proceed to Step A4
  - No email in output → output: "Sign-in may not have completed. Please try again, or use the API key fallback: `apimatic auth login --auth-key=YOUR_API_KEY`. Your API key is at: APIMatic Dashboard > Account > API Keys."
- "No" or "I got an error" → output: "Use `apimatic auth login --auth-key=YOUR_API_KEY` instead. Your API key is at: APIMatic Dashboard > Account > API Keys." Then run `apimatic auth status`. If still no email → stop: "Authentication failed. Do not proceed until authenticated."

---

## Step A4: Choose SDK languages

A portal needs at least one SDK language. The sample project lists all three available languages: C#, TypeScript, and Python. Unless the user already said which languages they want, keep all three — do not ask. The user can remove languages later.

---

## Step A5: Scaffold the project and start the portal

A new project has no preview yet, so there is nothing to check first. `serve.mjs` keeps each project's preview separate, and a preview of another project on this machine is left running.

Create the project directory:

```
mkdir my-portal
cd my-portal
```

Replace `my-portal` with the user's preferred project name.

Download the **v2** branch of the sample portal repository and extract its `src/` directory. The `master` branch holds the CLI v1 sample and will not work with CLI v2.

```
curl -L -o /tmp/sample-portal.zip https://github.com/apimatic/sample-docs-as-code-portal/archive/refs/heads/v2.zip
unzip -o /tmp/sample-portal.zip "sample-docs-as-code-portal-2/src/*" -d /tmp/sample-portal-extracted
cp -r /tmp/sample-portal-extracted/sample-docs-as-code-portal-2/src ./src
rm -rf /tmp/sample-portal.zip /tmp/sample-portal-extracted
```

GitHub names the folder inside the zip `sample-docs-as-code-portal-2`. If the extract finds nothing, list the zip's top-level folder and use that name. On Windows, or if `unzip` is unavailable, adapt using `tar`, PowerShell `Expand-Archive`, or a Node.js/Python script.

The scaffold contains:

```
src/
├── apimatic.json          # portal settings and SDK languages
├── content/
│   ├── index.mdx          # home page
│   └── nav.json           # the tabs, and Home's sidebar order
├── spec/
│   └── openapi.json       # sample API definition
└── static/
    └── images/            # placeholder logos and favicon
```

**Spec replacement (conditional):** If the user provided a spec path in Step 2, or if a spec file is available in the current working directory (look for `*.json`, `*.yaml`, `*.yml` files that appear to be OpenAPI, Swagger, or Postman specs):

- Remove the sample spec: `rm src/spec/openapi.json`
- Check the spec's format. The portal reads **only OpenAPI 3.x** — a JSON or YAML document whose top-level `openapi` field starts with `3.`.
  - OpenAPI 3.x → copy the user's spec into `src/spec/`.
  - Anything else (a `swagger: "2.0"` document, a Postman collection, RAML, WSDL, …) → convert it, writing the result outside `src/spec/`:

    ```
    apimatic api transform --format=openapi3yaml --file=<path to user's spec> --destination=./converted-spec --force
    ```

    It writes `./converted-spec/transformations/<name>_OpenApi3Yaml.yaml`. Move that file into `src/spec/` under a short name (e.g. `src/spec/api.yaml`), then delete `./converted-spec`. Tell the user their spec was converted to OpenAPI 3.x and that their original file is unchanged.

The spec's file name becomes the URL segment of its operation pages (below `/api/`), so keep a short, readable file name.

**Language selection (conditional):** Only if the user named specific languages in Step A4, edit the `languages` block of `src/apimatic.json` to list just those (e.g. `"languages": { "python": {} }`).

**DO NOT MAKE ANY OTHER CHANGES TO ANY FILE IN THE SRC FOLDER BEFORE STARTING THE PORTAL**

If no user spec is available, skip spec replacement — the sample spec works as-is for preview.

Start the server:

```
node {skill_dir}/scripts/serve.mjs start --input ./
```

The script streams `apimatic portal serve` output live and exits once the line `The portal is running at <url>` appears. The first start fetches the generated SDKs and code samples, so it can take a minute or two. When the URL appears, output the **Server Briefing** below verbatim, substituting the real URL.

**If the script exits with code 1 or times out without a URL:** read the CLI output it printed. CLI v2 explains each problem and names the file it is in — common causes are an invalid spec, a mistake in `src/apimatic.json`, or a page without a `title` in its front matter. Fix the specific problem (see `references/apimatic-json.md` and `references/content-and-navigation.md`; for spec errors run `apimatic api validate`), then retry `node {skill_dir}/scripts/serve.mjs start --input ./`.

If fixes do not resolve the issue, prompt the user to run the command manually:

"The server manager did not start. Please run `apimatic portal serve --open` yourself, then tell me what URL appears in the terminal."

Use AskUserQuestion:

```
question: "Is the server running? What URL do you see?"
options:
  - "Yes — http://localhost:23513"
  - "Yes — a different URL"
  - "No — I got an error"
```

---

## Server Briefing — output this verbatim when the server is confirmed running

```
Your portal is live at: <url>

Live reload is active. Edits to your pages, nav.json files, and the portal
settings in src/apimatic.json show up in the browser within a second or two.
Adding or removing pages, adding an SDK language, or changing the API spec
needs a quick restart, which I'll handle for you.

What you can do now:
- Open <url> in your browser to view the portal
- Edit src/apimatic.json to change the name, logo, colors, or header links
- Add .md files to src/content/ to create new pages

It will stop automatically after 30 minutes of inactivity.
To stop it now, tell me: "shut down the portal"
```

At the end of every subsequent response while the server is running, append:

> Portal server is running. It will stop automatically after 30 minutes of inactivity. To stop it now, tell me: **"shut down the portal"**

Read `references/apimatic-json.md` and `references/content-and-navigation.md` to understand the files created during setup before making changes.
