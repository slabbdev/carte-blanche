/**
 * Shared app chrome — ONE sidebar, identical on every page.
 * Pages declare an empty `<nav class="sidebar" data-active="planner"></nav>`
 * inside their shell; this script fills it with the canonical links, marks
 * the active one, and greets the logged account. Injected CSS keeps the
 * sidebar pixel-identical everywhere (no per-page drift).
 */
(function () {
  const LINKS = [
    { id: "console", href: "/", label: "Agent console", icon: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/>' },
    { section: "INTEGRATIONS" },
    { id: "planner", href: "/planner", label: "Journey planner", icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>' },
    { id: "oversight", href: "/oversight", label: "My agents (oversight)", icon: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="3"/>' },
    { id: "rc", href: "/dashboard", label: "Resolution Center", icon: '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/>' },
    { id: "verify", href: "/verify", label: "Public verification", icon: '<path d="M9 12l2 2 4-5"/><circle cx="12" cy="12" r="9"/>' },
    { id: "docs", href: "/docs", label: "API", icon: '<path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12"/>' },
  ];

  const CSS = `
  .shell { display: flex; align-items: stretch; max-width: 1280px; margin: 0 auto; width: 100%; }
  .sidebar { width: 228px; flex: 0 0 228px; background: #fff; border-right: 1px solid var(--border);
             display: flex; flex-direction: column; padding: 16px 10px;
             min-height: calc(100vh - 60px); position: sticky; top: 60px; }
  .nav-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 8px;
              color: inherit; font-size: 13.5px; text-decoration: none; }
  .nav-item svg { width: 17px; height: 17px; stroke: var(--muted); fill: none; stroke-width: 1.7;
                  stroke-linecap: round; stroke-linejoin: round; flex: 0 0 17px; }
  .nav-item.active { background: rgba(0, 112, 224, 0.09); color: var(--blue); font-weight: 700; }
  .nav-item.active svg { stroke: var(--blue); }
  .nav-section { margin: 20px 12px 6px; font-size: 10.5px; font-weight: 800; letter-spacing: 1px; color: var(--muted); }
  a.nav-item:hover { background: #f5f8fc; cursor: pointer; }
  .sidebar .foot { margin-top: auto; padding: 12px; font-size: 10.5px; line-height: 1.45; color: var(--muted); }
  .main { flex: 1; min-width: 0; }
  @media (max-width: 860px) { .sidebar { display: none; } }`;

  function init() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    const nav = document.querySelector("nav.sidebar[data-active]");
    if (nav && !nav.dataset.rendered) {
      const active = nav.dataset.active;
      nav.innerHTML =
        LINKS.map((l) =>
          l.section
            ? `<div class="nav-section">${l.section}</div>`
            : `<a class="nav-item${l.id === active ? " active" : ""}" href="${l.href}"><svg viewBox="0 0 24 24">${l.icon}</svg>${l.label}</a>`,
        ).join("") +
        '<div class="foot">Integration concept — simulation on sandbox rails. Not an official PayPal product.</div>';
      nav.dataset.rendered = "1";
    }

    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (!me) return;
        const acct = document.getElementById("acctName");
        if (acct && me.sub) acct.textContent = me.sub;
      })
      .catch(() => {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
