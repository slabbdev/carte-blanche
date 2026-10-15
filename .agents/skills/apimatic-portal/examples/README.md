# Portal examples

- `apimatic.json` — a complete `src/apimatic.json` using every portal setting, a `plugin` block, and all three SDK languages.
- `content/` — a sample `src/content/` directory:
  - `nav.json` — Home tab (named "Overview") with `index` and `changelog` in its sidebar, then the tabs listed in `tabs`: Guides, API Reference, SDKs, and Context Plugin.
  - `index.mdx` — home page using `<Cards>` and `<Callout>`.
  - `guides/` — a folder that is a tab because the root `nav.json` lists it in `tabs`, with its own `nav.json`, an `index.md` landing page, a page with an image from `src/static/images/`, and a page with a titled code block.

The image `/images/api-keys.png` referenced in `guides/quickstart.md` would live at `src/static/images/api-keys.png`.
