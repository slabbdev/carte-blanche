# Upgrading a Portal Project from CLI v1

Use this when a project's `src/` has `APIMATIC-BUILD.json` (with `generatePortal`) and `content/toc.yml`, but no `apimatic.json`. CLI v2 builds the portal on the user's machine from `src/`, and **`APIMATIC-BUILD.json` no longer configures the portal** — it now only describes SDK and plugin generation.

Before changing anything, tell the user what the upgrade involves and ask for confirmation. Suggest committing the project to git first so the v1 setup can be restored.

---

## What changes

| CLI v1 | CLI v2 |
|--------|--------|
| `generatePortal` in `src/APIMATIC-BUILD.json` | `portal` block in `src/apimatic.json` |
| `content/toc.yml` | A `nav.json` in each folder of `src/content/` |
| Pages without front matter | Every page starts with front matter giving its `title` |
| `portalSettings.languageSettings` keys like `python_generic_lib` | `languages` keys `csharp`, `python`, `typescript` |
| `src/plugin-config.json` | `plugin` block in `src/apimatic.json` |
| `apimatic portal toc new`, `portal recipe new`, `portal copilot` | Removed |
| `portal serve --destination`, `--no-reload` | Removed |
| `apimatic portal:serve` (colon syntax) | `apimatic portal serve` (spaces) |
| Node.js 20 | Node.js 24 or later |
| `npm install -g @apimatic/cli` | `npm install -g @apimatic/cli@beta` |

`src/spec/`, `src/content/`, and `src/static/` keep the same roles.

---

## Step 1: Create src/apimatic.json

Read `src/APIMATIC-BUILD.json` and map what has a v2 equivalent:

| v1 setting (under `generatePortal`) | v2 setting |
|-------------------------------------|------------|
| `baseUrl` | `portal.site.url` — the full address, including a path if the portal is hosted under one (e.g. `https://example.com/docs`) |
| `pageTitle` / `navTitle` | `portal.site.name` |
| `logoUrl` (+ `logoUrlDark`) | `portal.brand.logo` — a single `static/...` path, or `{ "light": ..., "dark": ... }`. See [Logo and favicon files](#logo-and-favicon-files) |
| `faviconUrl` | `portal.brand.favicon` (a `static/...` path). See [Logo and favicon files](#logo-and-favicon-files) |
| `portalSettings.theme.colors.primaryColor` (`{ light, dark }`) | `portal.brand.colors.primary` (hex, single value or `{ light, dark }` — both required in the object form) |
| `portalSettings.themeOverrides.palette.primaryColor` (older, single hex string) | `portal.brand.colors.primary` as a single value |
| `portalSettings.theme.colorMode.defaultMode` + `disableSwitch: true` | `portal.brand.colorMode` → `"light"` or `"dark"` |
| Header links in `src/components/header.html` | `portal.navigation.links` |
| `languageConfig` keys (`csharp`, `python`, `typescript`) and `portalSettings.languageSettings` (`cs_net_standard_lib`, `python_generic_lib`, `ts_generic_lib`) | `languages` → `"csharp": {}`, `"python": {}`, `"typescript": {}`. `http` has no equivalent |
| `languageConfig.*.packageSettings` / published SDK details | Re-run `apimatic sdk publish`, which records releases in `languages` |
| `src/plugin-config.json` | Re-run `apimatic sdk publish` and `apimatic plugin generate`, which write `languages` and `plugin`; then delete `plugin-config.json` |

A portal needs at least one language. Languages other than C#, Python, and TypeScript (Java, PHP, Ruby, Go) are not available in CLI v2 yet — tell the user which ones will be dropped.

### Logo and favicon files

In v2, `portal.brand.logo` and `portal.brand.favicon` must name a file inside `src/static/`, written relative to `src/` (`static/images/logo.png` or `./static/images/logo.png`). URLs are not accepted. Convert each v1 value:

- `/static/...` → remove the leading `/` (`/static/images/logo.png` → `static/images/logo.png`).
- `static/...` or `./static/...` → keep it as is.
- An absolute `https://` URL → download the file into `src/static/images/` and use that path, e.g. `curl -L -o src/static/images/logo.svg <url>`. If the download fails or the response is not an image (check the file type, not just the extension), leave the setting out and tell the user which logo or favicon was dropped and why.
- Without `faviconUrl`, v1 used `static/images/favicon.ico`; set `portal.brand.favicon` to it if that file exists. Without a favicon, v2 uses the light logo.

Start from this template and fill in the mapped values:

```json
{
  "$schema": "https://cdn.jsdelivr.net/npm/@apimatic/cli@beta/apimatic.schema.json",
  "schemaVersion": 1,
  "portal": {
    "site": {},
    "brand": { "colorMode": "both" },
    "navigation": { "links": [] },
    "ai": { "pageActions": true }
  },
  "languages": { "typescript": {} }
}
```

Settings with **no v2 equivalent** — tell the user they will no longer apply:

- API Recipes (`recipes.workflows`) and their scripts
- API Copilot (`apiCopilotConfig`, `portalSettings.copilot`)
- Theme fonts, typography, and colors other than the primary color. In `portalSettings.theme`: `fontSource`, `cssStyles`, `colors.linkColor`, `baseTheme`. In `portalSettings.themeOverrides`: `fontSource`, `cssStyles`, `themeType`, `palette.secondaryColor`, `palette.linkColor`, `palette.colors`
- Layout settings (`portalSettings.theme.layout` — sidebar mode, size, and resizing; content and container widths)
- `headIncludes`, `tailIncludes`, and `src/components/header.html` / `footer.html`
- Dynamic configuration (`APIMaticDevPortal.ready` / `setConfig`) and the Theme Control Hook
- `indexable` / SEO mode and `llmsContextGeneration` — v2 always publishes `sitemap.xml`, `robots.txt`, `llms.txt`, and `llms-full.txt`
- Versioned portals (`generateVersionedPortal`)
- `portalSettings` options such as `enableConsoleCalls`, `useProxyForConsoleCalls`, `enableExport`, `whiteLabel`, `codeSampleApi`, and TOC floater settings

Leave `APIMATIC-BUILD.json` in place if it holds SDK generation settings; CLI v2 ignores its portal settings.

## Step 2: Add front matter to every page

Every `.md`/`.mdx` file in `src/content/` needs front matter with a `title`. For each page, use the title `toc.yml` gave it (or its first `#` heading), and remove that heading from the body:

```md
---
title: Getting started
---
```

The CLI lists every page that still needs a title when it builds, so run `serve.mjs start` and fix what it reports.

## Step 3: Replace toc.yml with nav.json files

For each directory in `src/content/`, write a `nav.json` with the order `toc.yml` gave its pages, using bare file names without extensions:

```yaml
# v1 toc.yml
toc:
  - group: Getting Started
    items:
      - page: Introduction
        file: guides/introduction.md
      - page: Authentication
        file: guides/authentication.md
  - generate: API Endpoints
    from: endpoints
```

```json
// v2 src/content/guides/nav.json
{ "title": "Getting Started", "pages": ["introduction", "authentication"] }
```

```json
// v2 src/content/nav.json
{ "tabs": ["guides", "apimatic:api", "apimatic:sdks"], "pages": ["index", "..."] }
```

- `generate: ... from: endpoints` / `models` / SDK sections are replaced by the tokens `apimatic:api` and `apimatic:sdks`.
- A group that did not match a folder becomes a folder: move its pages into a directory named after it (update any links to them), or use a `(group)` folder to keep the URLs unchanged.
- Only what the root `nav.json` lists in `tabs` becomes a top-level tab. Everything else, including folders in `pages`, stays in Home's sidebar.

Then delete `src/content/toc.yml`. See `content-and-navigation.md` for all `nav.json` rules.

## Step 4: Replace v1-only page syntax

- `<CardGroup>` / `<Card url="page:...">` → `<Cards>` / `<Card href="/...">` with the page's URL
- `page:` links → normal Markdown links to the page URL (`[Quickstart](/guides/quickstart)`)
- Images → `/images/x.png` for files in `src/static/images/`, or a path relative to the page

## Step 5: Preview and fix

Upgrade the CLI (`npm install -g @apimatic/cli@beta`, Node 24+) — tell the user first, using the upgrade message in `SKILL.md` Prerequisites — then start the preview with `serve.mjs start --input ./`. Fix each problem the CLI reports, then continue with Path B in `SKILL.md`.

If the API playground used OAuth sign-in, tell the user to register `<portal address>/oauth/callback` as a redirect URI with their OAuth provider (see `SKILL.md`, OAuth sign-in in the API playground).

If the user uses shell completion, suggest `apimatic autocomplete --refresh-cache` to drop the removed commands.
