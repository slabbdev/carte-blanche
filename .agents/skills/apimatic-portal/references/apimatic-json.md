# The apimatic.json file

`src/apimatic.json` is the APIMatic CLI v2 project file. It holds three sections, all optional:

- **`portal`** — the documentation portal built by `apimatic portal generate` and `apimatic portal serve`
- **`languages`** — the project's SDK languages. A portal needs at least one. `apimatic sdk publish` adds release details to it
- **`plugin`** — the Context Plugin's identity, written by `apimatic plugin generate`

Source: https://docs.apimatic.io/v4/generate-developer-portals/apimatic-json-reference

## Contents

- [Complete example](#complete-example)
- [Top-level properties](#top-level-properties)
- [portal](#portal)
- [languages](#languages)
- [plugin](#plugin)
- [Value formats](#value-formats)
- [Common tasks](#common-tasks)

---

## Complete example

```json
{
  "$schema": "https://cdn.jsdelivr.net/npm/@apimatic/cli@beta/apimatic.schema.json",
  "schemaVersion": 1,
  "portal": {
    "site": {
      "name": "Acme Payments",
      "url": "https://docs.acme.com",
      "description": "Accept payments and manage payouts with the Acme API."
    },
    "brand": {
      "logo": {
        "light": "static/images/logo-light.png",
        "dark": "static/images/logo-dark.png"
      },
      "favicon": "static/images/favicon.png",
      "colors": {
        "primary": { "light": "#1d4ed8", "dark": "#60a5fa" }
      },
      "colorMode": "both"
    },
    "navigation": {
      "links": [
        { "label": "Dashboard", "url": "https://dashboard.acme.com" },
        { "label": "Changelog", "url": "/changelog" }
      ]
    },
    "ai": {
      "pageActions": true
    }
  },
  "languages": {
    "typescript": {},
    "python": {},
    "csharp": {}
  }
}
```

Keep the `$schema` line: it gives autocomplete and validation in VS Code and other JSON-aware editors. The CLI ignores it.

---

## Top-level properties

| Property | Type | Description |
|----------|------|-------------|
| `$schema` | string | Where editors find the JSON schema. Ignored by the CLI. |
| `schemaVersion` | `1` | Format of this file. Must be `1`; the CLI refuses a version it does not read. |
| `portal` | object | Documentation portal settings. |
| `languages` | object | SDK languages and where they are published. |
| `plugin` | object | Context Plugin identity. |

Unknown top-level properties are ignored.

---

## portal

**Unknown properties are not allowed anywhere inside `portal`.** A misspelled or invented key (for example `theme`, `fonts`, `copilot`, `headIncludes`, `baseUrl`) fails the build. These are the only settings:

| Property | Type | Description |
|----------|------|-------------|
| `site` | object | Name, address, and description of the portal. |
| `brand` | object | Logo, favicon, primary color, and color mode. |
| `navigation` | object | Header links. |
| `ai` | object | AI features on portal pages. |
| `pluginUrl` | string | Where a Context Plugin hosted elsewhere lives. Must start with `https://` and contain no spaces. Adds the Context Plugin page. See `context-plugins.md`. |

### portal.site

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | non-blank string | Title of the only spec | The portal's name. **Required** when `src/spec/` holds more than one spec. |
| `url` | string | — | The address the portal is hosted at: an origin such as `https://docs.example.com`, or an origin and a path such as `https://example.com/docs` to host the portal under that path. `http://` and `https://` are accepted; one trailing `/` is allowed. Adds canonical links to every page, makes the URLs in `sitemap.xml` absolute, and (at the root of a host) adds the sitemap to `robots.txt`. Set it for any portal that should be indexed by search engines. |
| `description` | string | First paragraph of the only spec's description | Portal description. An empty string means no description. |

Never set `url` to a localhost address.

#### Hosting under a path

When `url` has a path, the portal is built to be served under it: every page, asset, `sitemap.xml`, and `llms.txt` lives below `https://example.com/docs/`. Rules for the path:

- Each part between `/`s uses only letters, digits, `.`, `_`, `~`, and `-`, and cannot be `.` or `..`. No empty parts (`//`).
- No `?`, `#`, or `\`.
- It cannot end in a page name such as `index.html`.

What changes:

- Links in pages and in `navigation.links` stay portal-relative (`/guides/quickstart`); the build adds the path.
- No `robots.txt` is generated, since crawlers read it only at a host's root. If the user controls the root, add `Sitemap: https://example.com/docs/sitemap.xml` to its `robots.txt`.
- The host must serve the build at the path and serve `404.html` for missing pages under it.
- The preview is served under the path too (e.g. `http://localhost:23513/docs/`). **Changing the path needs the preview restarted.**
- The OAuth redirect URI for the API playground is `https://example.com/docs/oauth/callback`.

```json
"site": {
  "name": "Acme Payments",
  "url": "https://acme.com/docs"
}
```

### portal.brand

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `logo` | static path, or `{ "light", "dark" }` | — | One image for both color modes, or one per mode. The object form needs both `light` and `dark`. |
| `favicon` | static path | The light logo | Browser tab icon. |
| `colors.primary` | color, or `{ "light", "dark" }` | — | Primary brand color for both modes, or one per mode. The object form needs both `light` and `dark`. |
| `colorMode` | `"light"` \| `"dark"` \| `"both"` | `"both"` | Color modes the portal offers. Forcing `light` or `dark` hides the theme switch. |

`primary` is the only color setting. There are no settings for fonts, secondary colors, or custom CSS.

One logo and color for both modes:

```json
"brand": {
  "logo": "static/images/logo.svg",
  "colors": { "primary": "#1d4ed8" }
}
```

Dark mode only (no theme switch):

```json
"brand": {
  "colorMode": "dark"
}
```

### portal.navigation

| Property | Type | Description |
|----------|------|-------------|
| `links` | array of [links](#links) | Links shown in the header and the mobile menu, in order. |

```json
"navigation": {
  "links": [
    { "label": "Status", "url": "https://status.acme.com" },
    { "label": "Quickstart", "url": "/guides/quickstart" }
  ]
}
```

The sidebar and tabs are not configured here — they come from `nav.json` files in `src/content/`. See `content-and-navigation.md`.

### portal.ai

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `pageActions` | boolean | `true` | Whether each page offers to open itself in an external AI assistant. |

The portal also always publishes `/llms.txt`, `/llms-full.txt`, and a Markdown copy of every page at `<page-url>.md`. There is nothing to configure for these.

---

## languages

The project's SDK languages. Keys must be one of:

`csharp` · `python` · `typescript`

A portal needs **at least one** language. Each language gets:
- a card on the **SDKs** page with a download link
- a page with that SDK's getting-started guide
- a code sample in that language on every API reference page

Declare a language that is not published yet with an empty object:

```json
"languages": { "typescript": {}, "python": {} }
```

After `apimatic sdk publish` runs, it records the release in that language's `publishing` entry (source repository, branch, package name, version). The SDK card then also shows the install command, package, and repository. **Do not hand-write `publishing` entries** — let `apimatic sdk publish` write them.

The order of keys is the order of the SDK cards and language tabs. Adding a language needs the preview restarted, because each language's SDK is fetched when the preview starts. Removing one applies live.

---

## plugin

The Context Plugin's identity. `apimatic plugin generate` asks for these values on its first run and writes them here. Adding a `plugin` block adds a **Context Plugin** page to the portal — a tab when `apimatic:plugin` is in the root `nav.json`'s `tabs` (restart the preview after adding it).

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `pluginId` | string | **Yes** | Lower-case alphanumeric words separated by single dashes, e.g. `acme-payments`. |
| `pluginName` | non-blank string | **Yes** | Display name, e.g. `Acme Payments`. |
| `pluginVersion` | string | **Yes** | `major.minor.patch`, e.g. `0.1.0`. |
| `pluginKey` | string | No | Plugin key. |
| `author.name` | string | No | Author name. |
| `author.email` | string | No | Author email. |
| `license` | string | No | License identifier, e.g. `MIT`. |
| `homepage` | string | No | Homepage URL. |
| `repository` | string | No | Source repository URL. |

If `plugin` is present without `pluginId`, `pluginName`, and `pluginVersion`, the file fails validation.

---

## Value formats

### Static paths

Paths to files inside `src/static/`, written relative to `src`. A leading `./` is allowed; `.` and `..` segments are not.

| Valid | Invalid |
|-------|---------|
| `static/images/logo.png` | `images/logo.png` (not under `static`) |
| `./static/logo.svg` | `static/../logo.png` (`..` segment) |
| `static\images\logo.png` | `static` (no file) |

If `src/static/` did not exist when the preview started, restart the preview after creating it.

### Colors

`#rgb` or `#rrggbb` hex, e.g. `#1d4ed8` or `#fff`. Case-insensitive. Named colors (`blue`) and `rgb()` are not accepted.

### Links

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `label` | non-blank string | Yes | Text shown for the link. |
| `url` | string | Yes | A portal page starting with `/` (e.g. `/changelog`), or an external address starting with `https://` or `http://`. Protocol-relative URLs such as `//example.com` are rejected. |

Unknown properties are not allowed on links.

---

## Common tasks

| User asks | Change |
|-----------|--------|
| "Change the portal title" | `portal.site.name` |
| "Add my logo" | Copy the file into `src/static/images/`, set `portal.brand.logo` to `static/images/<file>` |
| "Different logo for dark mode" | `portal.brand.logo` → `{ "light": "...", "dark": "..." }` |
| "Use our brand color" | `portal.brand.colors.primary` → hex value |
| "Dark mode only" / "remove the theme toggle" | `portal.brand.colorMode` → `"dark"` or `"light"` |
| "Add a link to our dashboard in the header" | Append to `portal.navigation.links` |
| "Remove the Ask AI / open in ChatGPT buttons" | `portal.ai.pageActions` → `false` |
| "Set up SEO" / "fix the sitemap URLs" | `portal.site.url` → production address |
| "Host the portal at example.com/docs" | `portal.site.url` → `https://example.com/docs`, then restart the preview and rebuild |
| "Only show Python SDK" | `languages` → `{ "python": {} }` |
| "Change fonts" / "custom CSS" / "API Copilot" / "recipes" | Not available in CLI v2 — tell the user; do not add keys |

After editing, follow the preview protocol in `SKILL.md`.
