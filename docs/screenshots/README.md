# Screenshots (Devpost image pack, 1440x900)

Shot on the React back-office (Connect-with-PayPal login, sandbox rails):

- `console.png` — Agent console: real sandbox balance, quick access, performance, the prompt-and-budget autopilot card
- `planner.png` — Journey planner: live catalog, derived mandate, Bryntum execution board, price watch
- `oversight.png` — My agents: agent passports, purchases with evidence packs, sealed contestations, track record
- `dashboard.png` — Resolution Center: automation rules (coverage-aware), recent sales with net-after-fees, disputes grid, drawer with coverage matrix / fast lane / Contacter l'acheteur
- `analytics.png` — AG Studio: Threshold KPI tiles, charts, the agents' prompt starters
- `board.png` — dispute kanban (Bryntum TaskBoard)
- `verify.png` — public verification, no account: every signature + Merkle inclusion proof

Regenerate: `npx playwright@latest screenshot --viewport-size=1440,900 --load-storage=… http://localhost:8790/<route> docs/screenshots/<name>.png`
