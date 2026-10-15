---
name: apimatic-sdk
description: Use for any task involving APIMatic's SDK generation toolchain (APIMatic CLI v2). Use when a user wants to generate, create, customize, download, or publish a C#, Python, or TypeScript SDK using the APIMatic CLI. Also use when the user has already customized a generated SDK and wants to save those changes, when the user wants to make a specific change to an SDK (e.g. "change the analyzer", "switch the linter", "disable linting"), when the user wants to validate, check, lint, or review an API definition or OpenAPI/Swagger spec for errors or problems (e.g. "check my spec", "what's wrong with my OpenAPI file"), even if they don't mention SDKs, when the user wants to transform or convert an API definition to another format, or when the user wants to publish an SDK to a package registry (NuGet, PyPI, npm) or source repository, or wants to list publishing profiles.
---

# APIMatic SDK

Generate SDKs for your APIs using the APIMatic CLI.

This skill targets **APIMatic CLI v2** (`@apimatic/cli@beta`), documented at https://docs.apimatic.io/v4. CLI v2 generates SDKs with Codegen v4 in **C#, Python, and TypeScript**.

## When to Use

- User wants to create, generate, or download an SDK using the APIMatic CLI
- User wants to customize an SDK, asks about custom code injection, or wants to preserve customizations across regenerations
- User mentions `sdk save-changes` or asks how to save SDK changes
- User says they have already customized a generated SDK and want to save or commit those changes
- User asks to customize an SDK in a specific way (e.g. "change the analyzer", "switch the linter", "update the test framework in the TypeScript SDK")
- User wants to validate, check, lint, or review their API definition or OpenAPI spec for errors or problems (e.g. "check my spec", "something seems off with my API spec", "what's wrong with my OpenAPI file"), even if they don't mention SDKs or generation
- User wants to convert their API definition to another format
- User wants to publish an SDK to a package registry (NuGet, PyPI, npm) or source code repository (GitHub)
- User wants to list publishing profiles or find a profile ID for publishing
- User mentions `sdk publish` or `publishing profile list`

## Red Flags — STOP and re-read the relevant section

- About to install `@apimatic/cli` or `@apimatic/cli@latest` → those install CLI v1. Install `@apimatic/cli@beta`, which needs Node.js 24 or later
- About to generate or publish a Java, PHP, Ruby, or Go SDK → CLI v2 supports only `csharp`, `python`, and `typescript`. Tell the user the language is not available yet and offer the supported ones; do not run the command
- About to pass the spec file path to `--input` → `--input` must point to the parent directory that contains `src/`, not the spec file itself (e.g., `--input=./my-project`, not `--input=./openapi.yaml`) → commands run from project root, never from inside `src/`
- About to check an API definition for problems by reading the file yourself → run `apimatic api validate` (see [Validate or Transform the API Definition](#validate-or-transform-the-api-definition)); reading the file misses APIMatic's validation and linting rules
- About to add `--zip` when the user didn't ask for it → only include `--zip` if the user explicitly requested a zip download
- About to rerun `sdk generate` with `--force` without asking → when the CLI shows the "destination … is not empty, do you want to overwrite?" prompt (or exits right after it), ask the user before adding `--force`
- About to `cd src/` before running generate → run from the project root (the directory that _contains_ `src/`), never from inside `src/`
- About to proceed to SDK generation before the user confirms browser auth → wait for user confirmation after launching browser login, then verify with `apimatic auth status`
- About to use `--track-changes`, `--skip-changes`, or `sdk save-changes` without checking that the installed CLI supports them → run the [Change Tracking Availability Check](#change-tracking-availability-check) first
- About to run `sdk save-changes` without `--track-changes` having been enabled → change tracking must be initialized during generation; regenerate with `--track-changes` first
- About to add `--api-version` when user hasn't mentioned a specific API version → only include `--api-version` when the user explicitly names a version
- About to ask for information the user already stated in their prompt → use what was given; only ask for genuinely unknown values, and ask all of them together in one message instead of one per turn
- About to change the SDK through a CodeGen settings file → Codegen v4, the only generator in CLI v2, supports no CodeGen settings. Follow [CodeGen Settings](#codegen-settings) instead
- About to open, read, or edit the `.<language>` files inside `sdk-source-tree/` (e.g., `.typescript`, `.python`) → these files are managed exclusively by the CLI; never touch them directly under any circumstance
- About to manually compare or inspect customizations by reading `sdk-source-tree/` → if the user wants to see what changed between a plain generation and their customized one, regenerate using `--skip-changes` to produce a clean copy, then compare that against the customized SDK; do not manipulate or read the source tree files
- About to run `sdk publish` because the user said "for publishing", "to publish", "for npm", or similar contextual phrases → these describe the user's **goal**, not a publish instruction; only run `sdk publish` if the user explicitly asks to publish (e.g., "publish the SDK", "run sdk publish", "push to npm using apimatic", "push to GitHub using apimatic"); for any other phrasing, stop at SDK generation
- About to run `sdk publish` without a `--profile-id` and the user hasn't provided one → run `apimatic publishing profile list` first and present the available profiles so the user can choose
- About to pass a `--publish-type` value other than `package` or `sourcecode` → see the [Publish Types](#publish-types) section for valid values
- About to hand-edit the `publishing` entries in `src/apimatic.json` → `apimatic sdk publish` writes them; leave them alone
- About to cancel or rerun `sdk publish` because the output shows "publishing is queued" for a long time → do not cancel or rerun; the queued state is normal and the command will complete on its own; only act if the CLI exits with an explicit error message
- About to finish responding after `sdk publish` without sharing the logs URL → always extract the `https://dash.apimatic.io/publish/.../logs/...` URL from the CLI output and show it to the user, whether publishing succeeded or failed; never skip this step

## Communication Guidelines

This skill is used by developers of all experience levels. All messages shown to the user must be clear, non-technical, and action-oriented. Follow these rules in every response:

- **Show CLI output in a code block:** After a command finishes, display the final terminal output to the user wrapped in a fenced code block. Before rendering, strip ANSI escape codes and remove duplicate consecutive lines caused by spinner animation (keep only the last occurrence of each repeated line). Do not summarize or paraphrase — show the cleaned output as-is inside the code block. The one exception is `apimatic publishing profile list`, which is summarized instead (see [Publish Step 2](#step-2-find-the-publishing-profile-id)).
- **Use the verbatim blocks provided:** When this skill provides a specific message to show, output it exactly as written. Do not paraphrase or add technical context around it.
- **Keep error guidance actionable:** When something fails, show the cleaned CLI output in a code block, then tell the user what went wrong in simple terms and what they can do about it. Do not describe the internal recovery steps you are attempting — just attempt them silently and report the outcome.
- **When in doubt, less is more:** If you are unsure whether a detail is useful to the user, leave it out.

## Customize an SDK

## Fast Path — Already-Customized SDK

If the user's message indicates they have **already made customizations** to a generated SDK and want to save those changes (e.g. "I customized my SDK", "I made changes to the generated SDK", "save my SDK changes", "save changes in it"):

1. Confirm the Prerequisites section below is satisfied (Node.js 24+, CLI v2 installed).
2. Complete Step 1: Authenticate with APIMatic below.
3. Run the [Change Tracking Availability Check](#change-tracking-availability-check).
4. **Check for `sdk-source-tree`** — see the [SDK Source Tree Check](#sdk-source-tree-check) section below.

## Fast Path — Apply a Specific Customization to an SDK

If the user asks Claude to make a specific change to an SDK (e.g. "change the analyzer to something else", "switch the linter in my Python SDK", "update the test framework in my TypeScript SDK"):

1. Confirm the Prerequisites section below is satisfied (Node.js 24+, CLI v2 installed).
2. Complete Step 1: Authenticate with APIMatic below.
3. If the user expects the change to be a generation setting, first tell them as described in [CodeGen Settings](#codegen-settings).
4. Run the [Change Tracking Availability Check](#change-tracking-availability-check), then **check for `sdk-source-tree`** — see the [SDK Source Tree Check](#sdk-source-tree-check) section below.

Do not ask whether the user wants to customize or save — they have already told you what change to make. Proceed without prompting unless something is genuinely unknown.

## CodeGen Settings

CLI v2 generates SDKs with Codegen v4, which does not support CodeGen settings. Every change to a generated SDK is a code customization.

When the user expects a change to be a generation setting, tell them:

> "The current SDK generator doesn't support configuration settings, so this can't be switched on in a config file. I can make the change directly in the generated SDK code instead."

If the user wants to go ahead, treat the request as a code customization: run the [Change Tracking Availability Check](#change-tracking-availability-check), then continue with the [SDK Source Tree Check](#sdk-source-tree-check).

---

## Change Tracking Availability Check

Change tracking (`--track-changes`, `--skip-changes`, and `apimatic sdk save-changes`) keeps custom code across regenerations. It is part of the v4 CLI reference, but not every CLI v2 beta release includes it. Before using any of these, check the installed CLI once per session:

```
apimatic sdk generate --help
```

- **The output lists `--track-changes`** → change tracking is available. Continue with the [SDK Source Tree Check](#sdk-source-tree-check) and `references/save-changes.md`.
- **The output does not list `--track-changes`** → change tracking is not available in the installed CLI. Do not run `--track-changes`, `--skip-changes`, or `sdk save-changes`, and skip `references/save-changes.md`. Trust the `--help` output even if the user says change tracking is already enabled — tell them the installed CLI version doesn't include it, then continue with the case below that matches their request.

  - **Claude is applying a customization** (Fast Path — Apply a Specific Customization, or Step 6 when the user wants Claude to make the changes). Tell the user:

    > "Saving customizations so they're reapplied on every regeneration isn't available in the version of the APIMatic CLI you have installed. I can still make the change, but it will be overwritten the next time the SDK is regenerated. To keep it safe, I'll put custom logic in new files where possible and note every change in the SDK's README so it's easy to reapply."

    If the user wants to proceed, apply the change following the [Customization Guidelines](#customization-guidelines) and stop there.

  - **The user has already customized an SDK and wants to save it, or will make the customizations themselves** (Fast Path — Already-Customized SDK, or Step 6 when the user handles the changes). Do not regenerate. Tell the user:

    > "Saving customizations so they're reapplied on every regeneration isn't available in the version of the APIMatic CLI you have installed. Your changes are safe in the SDK folder as long as the SDK isn't regenerated into that same folder. To keep them, commit the SDK to version control and list each change in the SDK's README so it's easy to reapply after a regeneration."

    If the user asks, help document their changes in the README following the [Customization Guidelines](#customization-guidelines), then stop.

  - **The user wants to see the SDK without their customizations** (the `--skip-changes` case). With no change tracking, nothing is reapplied, so a plain generation already produces the uncustomized SDK. Run Steps 4–7 without `--skip-changes`, and make sure `--destination` is not the user's customized SDK folder so it isn't overwritten — ask for a path or use `<input>/sdk/plain`.

---

## SDK Source Tree Check

Look for `<input-dir>/src/sdk-source-tree/` (or `<input-dir>/sdk-source-tree/`) and within it a file named after the target language (e.g. `.typescript`, `.python`, `.csharp`).

**If `sdk-source-tree` is present and has an entry for the target language:**

Proceed directly to `references/save-changes.md`.

**If `sdk-source-tree` is absent or has no entry for the target language:**

Change tracking has never been initialized. Follow Steps 2 through 7 below to generate the SDK with `--track-changes`. Use any values already known from context (language, input dir, API version) — do not ask for them again. Only ask for values that are genuinely unknown.

There is one additional concern depending on context:

- **User has already made customizations (Fast Path — Already-Customized SDK):**
  The SDK must **not** be generated into the same folder as the user's existing customized SDK — doing so will overwrite their changes. Before running Step 7, ask only for the destination: "Change tracking isn't enabled for this SDK yet. I need to run a fresh generation to initialize it, but generating into your current SDK folder would overwrite your changes. Would you like me to use a temporary folder, or do you have a preferred destination?"
  - If user provides a path → use it as `--destination` in Step 4.
  - If user says temporary/default → use `<input>/sdk/temp/<language>` as `--destination` in Step 4. After generation, delete the `<input>/sdk/temp` directory — it is not needed.
    After Step 7 completes, follow `references/save-changes.md` with `--sdk` pointing at the user's **original** customized SDK path, so their customizations are captured — not the temp output.

- **Claude is applying the customization (Fast Path — Apply a Specific Customization):**
  No destination conflict — proceed through Steps 2–7 normally with `--track-changes`. After generation, apply the requested customizations to the generated SDK following the [Customization Guidelines](#customization-guidelines) section, then follow `references/save-changes.md`.

## Customization Guidelines

Apply these principles whenever you are making SDK customizations on the user's behalf, and share them as tips when the user is customizing themselves.

1. **Add custom logic in a new file** where possible.
2. **Avoid editing generated files directly.**
3. **If you must edit a generated file**, add your changes at the top or bottom to reduce merge conflicts.
4. **Update the SDK README after every customization:** After applying any customization, open the SDK's `README.md` and add a section (or update an existing one) that describes what was customized and why. This keeps the SDK self-documenting so future developers know what changes were made intentionally.

---

## Generate an SDK

> These steps (Prerequisites through Step 7) are also used when initializing change tracking as part of a customization workflow.

## Prerequisites

Confirm these are in place before starting:

- **Node.js 24 or later and npm installed**
  CLI v2 refuses to run on older Node versions, even though npm lets the install finish. If Node is missing or older than v24, download it from https://nodejs.org/en/download/. Verify with:

  ```
  node --version
  ```

- **APIMatic account**
  Free trial available at app.apimatic.io. Required for authentication.

- **APIMatic CLI v2 installed globally:**

  ```
  npm install -g @apimatic/cli@beta
  ```

  Always keep the `@beta` tag in every install or reinstall command you run or suggest. Without it, npm resolves the package to CLI v1: `@apimatic/cli` and `@apimatic/cli@latest` both still point to v1. If the user says they installed the CLI without `@beta`, tell them that command installs CLI v1, not the v2 that SDK generation needs, and give them the `@beta` command. Say this even when `apimatic --version` shows v2 is already installed: running their command again later would replace v2 with v1.

  Verify the CLI is available:

  ```
  apimatic --version
  ```

  The output should start with `@apimatic/cli/2.`. If the command fails, CLI v2 is not installed — run the `@beta` install command above. Do not continue to authentication or SDK generation until `apimatic --version` prints `@apimatic/cli/2.`.

  If it shows `1.x`, CLI v1 is installed. Before upgrading, tell the user (substituting the version it printed):

  > "You have APIMatic CLI v1 (`<version>`) installed, and SDK generation here needs CLI v2. I'm upgrading your APIMatic CLI to v2 now with `npm install -g @apimatic/cli@beta`. This replaces v1 on this machine; to switch back later, run `npm install -g @apimatic/cli@1`."

  Then run the install command and check `apimatic --version` again.

---

## Step 1: Authenticate with APIMatic

First check whether the user is already authenticated:

```
apimatic auth status
```

If the output shows an account email, authentication is already in place — skip to Step 2. The output also has an `Allowed Languages` line: these are the languages the user's plan is entitled to, not the languages CLI v2 can generate. It can list `go`, `java`, `php`, or `ruby`, but only `csharp`, `python`, and `typescript` can be generated today (see Step 3).

**Primary flow (browser-based):**

Run the auth launcher script from the project directory. It spawns `apimatic auth login` as a detached process so the terminal does not block:

```
node {skill_dir}/scripts/auth-login.mjs
```

Where `{skill_dir}` is the absolute path to the directory containing the `apimatic-sdk` skill file (the `auth-login.mjs` script lives there).

The script launches the browser sign-in flow and immediately returns. Relay the following message to the user: "A browser window has opened. Complete sign-in in the browser, then confirm here when done."

Wait for the user to confirm sign-in is complete before proceeding.

After confirmation, verify auth succeeded:

```
apimatic auth status
```

The output should show the account email. If it does not, authentication did not complete — try the fallback below.

**Fallback flow (API key):**

Use this when browser auth is not available (CI environment, Docker, headless system) or when the user prefers a key-based approach. API keys are generated at: APIMatic Dashboard > Account > API Keys.

Option 1 — sign in once with the key (works for every command, including `sdk publish`):

```
apimatic auth login --auth-key=YOUR_API_KEY
```

Option 2 — pass the key to each command with `--auth-key` (supported by `sdk generate`, `api validate`, `api transform`, and `plugin generate`; **not** by `sdk publish`):

```
apimatic sdk generate --language=<language> --auth-key=YOUR_API_KEY
```

In CI or containers, keep the key in a secret or environment variable and expand it into the flag, e.g. `--auth-key="$APIMATIC_API_KEY"` (bash) or `--auth-key="$env:APIMATIC_API_KEY"` (PowerShell). CLI v2 does not read an API key from the environment on its own.

**If both methods fail:**

Stop the workflow. Tell the user:

"Authentication failed. Check that your APIMatic account is active, your API key is correct, and you have internet access to apimatic.io. If using browser login, try the --auth-key fallback instead."

Do not proceed past this point until authentication is confirmed.

## Step 2: Determine the input directory

If you do not know whether the user has an existing project with a `src/` folder, ask:

"Is this your first time generating an SDK for this API, or have you generated one before?"

- **Has a `src/` folder →** Ask: "What is the path to the directory that contains the `src/` folder?"
  The `--input` flag will point to this directory.

- **Starting from scratch →** Read `references/first-time-setup.md` and follow every step in order to scaffold the project directory with `src/spec/` and the user's API spec. Then continue to Step 3.

## Step 3: Choose the language

If the language is not already known from context, ask the user which language they want to generate the SDK in. Present the supported options:

| Flag value   | Language   |
| ------------ | ---------- |
| `csharp`     | C#         |
| `python`     | Python     |
| `typescript` | TypeScript |

If the user asks for Java, PHP, Ruby, or Go, tell them: "The current APIMatic CLI generates SDKs in C#, Python, and TypeScript. Java, PHP, Ruby, and Go aren't available yet." Then ask which of the supported languages they'd like instead. Do not run `sdk generate` with an unsupported language.

## Step 4: Choose the destination

If the destination is not already known from context, ask: "Do you have a specific path where you want the SDK to be generated, or should I use the default location?"

- **User provides a path →** Use the `--destination` flag with the given path.
- **User says default / no preference →** Omit the `--destination` flag. The SDK will be generated at `<input>/sdk/<language>` (or `<input>/sdk/<api-version>/<language>` if multiple API versions exist).

## Step 5: Choose the API version

Check whether the user wants to generate the SDK for a specific API version. Look for phrases like "versioned build", "specific version", "for version X", "v2", "api version", or any mention of targeting a particular version of their API.

- **User specifies a version →** Add `--api-version=<version>` to the generate command (e.g., `--api-version=v2`). This applies to projects whose `src/APIMATIC-BUILD.json` defines versioned builds.
- **User doesn't mention versioning →** Omit the `--api-version` flag. Do not ask.

## Step 6: Customization intent

If the user has already described a specific change they want (e.g., "remove the docs folder", "disable documentation", "set the project name", "disable linting"), it is a code customization (see [CodeGen Settings](#codegen-settings)). Treat it as "User says yes" below.

If the user hasn't said they want to customize the SDK, treat it as "User says no" below and do not ask. That includes requests that only ask to generate or regenerate (e.g. "just overwrite the old one", "use the default location, no zip"), fully specified commands, and CI pipelines. If the user decides to customize later, the [Already-Customized SDK](#fast-path--already-customized-sdk) fast path sets up change tracking without losing their changes.

- **User says yes →** Run the [Change Tracking Availability Check](#change-tracking-availability-check). If change tracking is not available, ask whether Claude or the user will make the changes (unless already known), follow the matching case there, and skip the rest of this step.

  Ask: "Do you already have a generated SDK you've customized, or are you starting fresh?"
  - **Already has a customized SDK →** Skip generation entirely. Ask: "Would you like me to apply the customizations, or will you handle them yourself?" then follow the appropriate path below.
  - **Starting fresh →** Add the `--track-changes` flag to the generate command. After generation completes in Step 7, ask: "Would you like me to apply the customizations, or will you handle them yourself?" then follow the appropriate path below.

  **If the skill applies customizations:**

  Ask the user what changes they want made. Apply them following the [Customization Guidelines](#customization-guidelines) section. Once the changes are in place, follow `references/save-changes.md`. See `examples/generate-customize-save.md` for the expected flow of commands — flags and paths will differ based on the user's setup.

  **If the user applies customizations:**

  See `examples/generate-customize-save.md` for the expected flow of commands — flags and paths will differ based on the user's setup.

  Share these tips before handing off:

  > - Add custom logic in a **new file** where possible — new files are never overwritten on regeneration.
  > - Avoid editing generated files directly.
  > - If you must edit a generated file, add your changes at the **top or bottom** to reduce merge conflicts.

  Then prompt: "Make your customizations now, then let me know when you're ready to save them." Once they confirm, follow `references/save-changes.md`.

- **User says no / no preference →** Omit the `--track-changes` flag.

## Step 7: Generate the SDK

Navigate to the project root (the directory that contains `src/`):

```
cd your-project-directory
```

Run the generate command with the chosen language:

```
apimatic sdk generate --language=<language>
```

To specify the input directory explicitly (the parent directory containing `src/`):

```
apimatic sdk generate --input=path/to/parent-of-src --language=<language>
```

**With an API key directly (recommended for CI — no interactive auth needed):**

```
apimatic sdk generate --input=path/to/parent-of-src --language=<language> --auth-key=YOUR_API_KEY
```

The CLI prints `SDK generated successfully.` and where the SDK was saved.

**If SDK generation fails:**

1. **Authentication error:** Re-run `apimatic auth status` to verify. If expired, re-authenticate (Step 1).
2. **Node.js too old:** The CLI refuses to run and names the Node version it found. Tell the user: "The APIMatic CLI needs Node.js 24 or later. Please install it from https://nodejs.org/en/download/ then come back."
3. **Missing `src/` folder or spec file:** Check that the input directory contains a `src/` folder with the API spec in `src/spec/`.
4. **Errors in the API definition:** If the CLI reports `SDK Generation failed.` with a message such as `Unable to parse file.`, the CLI could not read the API definition. Run `apimatic api validate` from the project root (it checks the definition in `src/spec/`) and explain the reported problems (see [Validate or Transform the API Definition](#validate-or-transform-the-api-definition)). The parsing problem is reported as **Blocking** with the line it fails on; fix it and re-run. A successful generation does not mean the definition is clean: Blocking issues and Errors that the CLI can still parse are generated as degraded code.
5. **Language not available:** If the CLI says the language is not available, only `csharp`, `python`, and `typescript` are supported — see Step 3.
6. **SDK already exists at destination:** Without `--force`, the CLI stops and asks `The destination '<path>' is not empty, do you want to overwrite?` (`○ Yes / ● No`). A non-interactive shell cannot answer it: the command exits right after the prompt, often with only a Node `Warning: Detected unsettled top-level await`, and no SDK is generated. Treat that output as "SDK already exists" — do not answer the prompt or retry. Immediately ask the user: "An SDK already exists at the destination. Would you like to overwrite it?" If yes, re-run the same command with `--force` appended (see Additional flags). If no, ask for a different destination path and re-run with `--destination=<new-path>`.
7. **`apimatic` command not found:** Run `npm install -g @apimatic/cli@beta` (always with `@beta`; without it npm installs CLI v1) and verify with `apimatic --version`.
8. **Unknown flag `--track-changes` / `--skip-changes`, or unknown command `save-changes`:** The installed CLI does not include change tracking — follow the [Change Tracking Availability Check](#change-tracking-availability-check).
9. **Any other error:** Read the exact error message from the CLI output. Do not retry automatically — diagnose the specific error first.

## Additional flags

- `-f, --force` : Overwrite if an SDK already exists in the destination. Use for repeated CI builds.
- `--zip` : Download the generated SDK as a .zip archive instead of a directory.
- `-d, --destination` : Where to write the SDK. Defaults to `<input>/sdk/<language>`.
- `-i, --input` : Path to the directory that contains `src/`. Defaults to `./`.
- `--api-version` : API version to generate for, when the project has versioned builds.
- `--stability=stable|beta` : Stability level of the generated SDK. Defaults to the level the language offers. Only set it when the user asks for a stable or beta SDK.
- `--codegen-version` : Code generator version. `v4` is the only (and default) value — omit it.
- `-k, --auth-key` : Authenticate with an API key instead of the signed-in session.
- `--track-changes` : Enable change tracking to preserve manual customizations across regenerations. Must be used during the initial generation to set up the source tree. Only when the [Change Tracking Availability Check](#change-tracking-availability-check) passes. See `references/save-changes.md` for how to save changes after generation.
- `--skip-changes` : Generate the SDK without reapplying saved customizations, even if change tracking is enabled. Use when the user wants to preview the plain generated output. Saved customizations are not modified and will still be applied in future runs unless explicitly removed. Only when the availability check passes.

Run `apimatic sdk generate --help` to see every option the installed CLI supports.

## Validate or Transform the API Definition

Use these when the user asks to check or convert their API definition, or when SDK generation reports spec errors.

When the user asks what is wrong with their spec, run `apimatic api validate` instead of only reading the file. Reading the file catches structural mistakes such as a broken `$ref` or a misspelled type, but misses APIMatic's linting rules (for example, `Server URLs should not point to example.com` and `Operation must have a summary` are Errors).

**Validate** — checks syntax and semantics against APIMatic's validation and linting rules:

```
apimatic api validate
apimatic api validate --input=<path-to-parent-of-src>
apimatic api validate --file=<path-to-spec>
apimatic api validate --url=<public-url-to-spec>
```

With no flags it validates everything in `./src/spec/` together, which is exactly what `sdk generate` uses; `--input` points at another project root. `--file` validates a single file. `--file`, `--url`, and `--input` cannot be combined.

When the user names a spec file:
- **The file is in the project's `src/spec/`** → use the no-flag form (or `--input` for another project root). It checks what generation will use.
- **The file is outside `src/spec/`, or the user wants only that one file checked** → use `--file=<path>`.

Messages are reported as:
- **Blocking**: the definition is broken, for example an unresolved `$ref` or a file that can't be parsed.
- **Error**: an invalid definition or a broken APIMatic rule, for example an invalid schema type, a server URL pointing to `example.com`, or an operation with no summary.
- **Warning**: can lower SDK quality.
- **Information**: suggestions.

Only a definition the CLI cannot parse stops SDK generation. Other Blocking issues and Errors do not: the SDK is still generated, but the affected parts are degraded (for example, a parameter with an invalid type or an unresolved `$ref` becomes an untyped `Any`). Do not tell the user that Errors prevent generation. Tell them to fix Blocking issues and Errors before relying on or publishing the SDK. For validation while editing, suggest the APIMatic extension for VS Code.

**Transform** — converts between formats (OpenAPI 3.x/2.0, RAML, Postman, API Blueprint, WSDL, WADL, GraphQL schema, APIMatic):

```
apimatic api transform --format=<format> --file=<path-to-spec> --destination=<dir>
```

`--format` values: `openapi3yaml`, `oas3`, `swaggeryaml`, `swagger20`, `swagger10`, `raml`, `raml10`, `postman20`, `postman10`, `apiblueprint`, `wsdl`, `wadl2009`, `graphqlschema`, `apimatic`. Add `--url` instead of `--file` for a public URL. If the output file already exists, the CLI asks `A specification file already exists at '<path>'. Do you want to overwrite the existing file?` and, in a non-interactive shell, exits without transforming (as in [Step 7 failure item 6](#step-7-generate-the-sdk)); ask the user before re-running with `-f, --force`. Transforming does not add the API to the APIMatic Dashboard.

## Publish an SDK

> **Only follow this section when the user explicitly requests publishing** (e.g., "publish the SDK", "push to npm", "push to GitHub", "run sdk publish"). Phrases like "generate an SDK for publishing" or "generate for npm" express intent but are not publish instructions — stop at SDK generation in those cases.

Publish an SDK to a package registry or source code repository (GitHub) using a publishing profile configured in the APIMatic App:

| Language   | Package registry |
| ---------- | ---------------- |
| C#         | NuGet            |
| Python     | PyPI             |
| TypeScript | npm              |

### Step 1: Authenticate with APIMatic

Follow [Step 1: Authenticate with APIMatic](#step-1-authenticate-with-apimatic) above. `sdk publish` has no `--auth-key` flag, so in CI run `apimatic auth login --auth-key=...` first.

### Step 2: Find the Publishing Profile ID

If the user does not already know their profile ID, run:

```
apimatic publishing profile list
```

This lists all publishing profiles with their names, IDs, and enabled languages, grouped by API with one table per API. This command is the exception to the "show CLI output in a code block" rule: do not forward the raw tables — summarize the available profiles in plain language (API, profile name, profile ID, enabled languages) so the user can identify the one they want.

If the user has no profile yet, tell them to create one in the Publishing Center on the APIMatic Dashboard: give it a name, enter the package details (name, description, authors), review each language's package settings, and save. Registry and GitHub credentials are added from the **Credentials** menu with **+ Add Credential**.

### Step 3: Choose the destination

Do not ask for a destination by default:

- **User provides a path →** Use the `--destination` flag with the given path.
- **User doesn't mention a destination →** Omit the `--destination` flag. The SDK will be generated at `<input>/sdk/<language>` (or `<input>/sdk/<api-version>/<language>` if multiple API versions exist).
- **Exception: that default folder already has files and this is not a dry run →** Step 4 always adds `--force`, which replaces the folder without asking and would erase any changes the user made there. Ask first: "There's already an SDK at `<path>`. Should I overwrite it, or generate the SDK for publishing somewhere else?" Skip this question in CI pipelines, where the folder holds only earlier builds.

### Step 4: Run SDK Publish

See `examples/publish-sdk.md` for the expected command and output — flags and paths will differ based on the user's setup.

**Non-interactive flow** requires all four of these flags — missing any one will drop the CLI into the interactive prompt:

```
apimatic sdk publish --profile-id=<profile-id> --language=<language> --version=<version> --publish-type=<type> --force
```

Always include `--force` (except with `--dry-run`, see [Dry Run](#dry-run)). Without it, an existing SDK at the destination triggers the overwrite prompt described in [Step 7 failure item 6](#step-7-generate-the-sdk), which a non-interactive shell cannot answer.

#### Flags

| Flag                 | Required (non-interactive) | Description                                                                                                                 |
| -------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `--profile-id`, `-p` | Yes                        | ID of the publishing profile to use. Run `apimatic publishing profile list` to find your profile ID.                        |
| `--language`, `-l`   | Yes                        | SDK language to generate and publish: `csharp`, `python`, or `typescript`.                                                  |
| `--version`, `-v`    | Yes                        | Semantic version of the SDK (`MAJOR.MINOR.PATCH`, e.g. `1.0.0`).                                                            |
| `--publish-type`     | Yes (at least one)         | Publishing target(s): `package` or `sourcecode` only. Can be specified multiple times. See [Publish Types](#publish-types). |
| `--input`, `-i`      | No                         | Path to the parent directory containing the `src/` directory. Defaults to `./`.                                             |
| `--destination`, `-d`| No                         | Directory where the generated SDK will be saved locally. Defaults to `<input>/sdk`.                                         |
| `--dry-run`          | No                         | Generate the SDK locally for review without publishing.                                                                     |
| `--force`, `-f`      | No                         | Overwrite existing output without prompting.                                                                                |
| `--stability`        | No                         | `stable` or `beta`. Only when the user asks for it.                                                                         |

#### Publish Types

Pass `--publish-type` once or twice to target one or both destinations. The language and publish type(s) must be configured in the publishing profile.

```
# Publish to package registry only
apimatic sdk publish --profile-id=<id> --language=csharp --version=2.0.0 --publish-type=package --force

# Publish to both package registry and source repository
apimatic sdk publish --profile-id=<id> --language=typescript --version=1.0.0 --publish-type=package --publish-type=sourcecode --force
```

If the user plans to build a **Context Plugin** (AI coding assistant context for their API), include `--publish-type=sourcecode`: the plugin references the SDK source repositories. The plugin itself is generated with `apimatic plugin generate` — see the `apimatic-portal` skill's `references/context-plugins.md`.

#### Dry Run

Use `--dry-run` to generate the SDK locally and inspect it before publishing:

```
apimatic sdk publish --dry-run --profile-id=<id> --language=python --version=1.0.0 --publish-type=package
```

A dry run always writes the SDK to a new folder under `~/Downloads/apimatic-sdk` (`apimatic-sdk (1)`, `apimatic-sdk (2)`, … when earlier runs exist) and ignores `--destination`, so it never hits the overwrite prompt and `--force` is not needed. Tell the user where the SDK was saved using the path the CLI prints.

### After SDK Publish Completes (Success or Failure)

After the command finishes — regardless of whether it succeeded or failed — scan the CLI output for a logs URL. It looks like:

```
https://dash.apimatic.io/publish/<publish-id>/logs/<log-id>
```

Always show it to the user with this exact message (substituting the actual URL):

> You can view the full publishing logs here: <logs-url>

This step is mandatory — never skip it regardless of success or failure.

A successful publish also records the release (language, package, version, repository) in the `languages` block of `src/apimatic.json`. An APIMatic portal built from the same project then shows the install command, package, and repository on that language's SDK card. Do not edit these entries by hand.

### If SDK Publish Fails

1. **Profile not found or invalid ID:** Run `apimatic publishing profile list` to confirm the correct profile ID.
2. **Language or publish type not supported by profile:** The language and publish type(s) must be enabled in the publishing profile. Check the profile configuration in the APIMatic App.
3. **Language not available:** Only `csharp`, `python`, and `typescript` can be published with CLI v2.
4. **Authentication error:** Re-run `apimatic auth status` and re-authenticate if needed.
5. **Any other error:** Read the exact error message from the CLI output. Do not retry automatically — diagnose the specific error first and ask the user before retry.

---
