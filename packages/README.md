# Open packages extracted from Carte Blanche

Sponsor-gift artifacts: the reusable, app-independent pieces of this project,
extracted so OTHER teams (and the sponsors themselves) can use them.

## channel3-lite — `packages/channel3-lite`

A dependency-free client + real-shape mapper for the Channel3 shopping API.
The API's real shape (price objects, domain merchants, affiliate buy links,
cleaned images, `next_page_token`) is documented and normalized once, with
tests. Zero dependencies, own build (`npm test` inside the directory).

## Why there is no `ag-grid-journey` package

The AG Grid integration (journey grid, dispute grid, evidence drawers) is
deliberately UI-coupled — its value is the wiring with signed artifacts and
the PayPal-style design system, which is not separable as a library without
becoming a worse version of AG Grid's own tooling. What IS reusable went to
the sponsors' own channels instead: their official skills (`ag-dev`,
`ag-update`) are vendored in `.agents/skills/` and drive all grid work in
this repo; the Theme-quartz params, pill-in-cell pattern and SSE async
transactions are documented inline where they're used (`/dashboard`,
`/planner`).

The APIMatic packaging path also lives here: `docs/openapi.json` is the
contract, APIMatic validates it and generates the TypeScript SDK committed at
`sdk/typescript/` (`carte-blanche-apilib`) — the API is consumable as a
package today, generated from the sponsors' own pipeline.
