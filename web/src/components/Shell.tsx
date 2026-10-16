import { useEffect, useState } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { api, esc } from "../api";

const LINKS = [
  { id: "console", href: "/", label: "Agent console", icon: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /></> },
  { section: "INTEGRATIONS" },
  { id: "planner", href: "/planner", label: "Journey planner", icon: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 11h18" /></> },
  { id: "oversight", href: "/oversight", label: "My agents (oversight)", icon: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="3" /></> },
  { id: "rc", href: "/dashboard", label: "Resolution Center", icon: <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /> },
  { id: "verify", href: "/verify", label: "Public verification", icon: <><path d="M9 12l2 2 4-5" /><circle cx="12" cy="12" r="9" /></> },
  { id: "docs", href: "/docs", label: "API", icon: <path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12" /> },
] as const;

interface Me { sub: string; profile?: { name?: string; givenName?: string; email?: string; payerId?: string; accountType?: string } | null }

export default function Shell({ requireAuth = true }: { requireAuth?: boolean }) {
  const loc = useLocation();
  const [me, setMe] = useState<Me | null | "anon">(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api<Me>("/api/auth/me").then(setMe).catch(() => setMe("anon"));
  }, [loc.pathname]);

  // public pages (verify/docs) keep the chrome without demanding a session —
  // "no account needed to verify a receipt" is a product claim, not an oversight
  if (requireAuth && me === "anon") return <Navigate to={"/login?next=" + encodeURIComponent(loc.pathname)} replace />;

  const profile = me && me !== "anon" ? me.profile : undefined;
  const displayName = me === "anon" ? "…" : profile?.givenName || profile?.name || me?.sub || "…";
  const typeLabel = profile?.accountType ? profile.accountType.toUpperCase() : "";

  return (
    <>
      <div className="bo-topbar">
        <button className="bo-burger" aria-label="menu" onClick={() => setOpen((o) => !o)}><span /><span /><span /></button>
        <Link className="wordmark" to="/" style={{ fontSize: 20 }}><span className="pay">Carte</span><span className="pal">Blanche</span></Link>
        <span className="bo-store">{profile?.name || "Demo Store"}</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 18 }}>
          <Link className="bo-devlink" to="/docs"><span>Developpeur</span><span style={{ background: "var(--red)", color: "#fff", borderRadius: 999, minWidth: 17, height: 17, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800 }}>0</span></Link>
          <span className="envchip">SANDBOX</span>
          {typeLabel && <span className={"typechip " + (profile?.accountType ?? "")}>{typeLabel}</span>}
          {me === "anon"
            ? <Link className="bo-gdbtn-white" to="/login">Log in</Link>
            : <span className="avatar" onClick={() => setOpen((o) => !o)} style={{ cursor: "pointer" }}>{displayName.slice(0, 2).toUpperCase()}</span>}
        </div>
        {open && me && me !== "anon" && (
          <div className="acct-pop" onMouseLeave={() => setOpen(false)}>
            <div className="acct-line big">{esc(profile?.name || me.sub)}</div>
            {profile?.email && <div className="acct-line">{esc(profile.email)}</div>}
            {profile?.payerId && <div className="acct-line mono">payer {esc(profile.payerId)}</div>}
            <div className="acct-line">
              <span className={"typechip " + (profile?.accountType ?? "")}>{profile?.accountType?.toUpperCase() || "PAYPAL"}</span>
              <span className="muted" style={{ fontSize: 11 }}>account</span>
            </div>
            <div className="acct-line muted" style={{ fontSize: 10.5 }}>{me.sub}</div>
            <button className="ghost" style={{ marginTop: 8, width: "100%" }} onClick={async () => {
              try { await api("/api/auth/logout", { method: "POST" }); } catch { /* gone */ }
              window.location.href = "/login";
            }}>Sign out</button>
          </div>
        )}
      </div>
      <div className="shell">
        <nav className="sidebar bo-sidebar">
          <Link className="bo-create" to="/planner"><span style={{ fontSize: 15 }}>+</span> Create</Link>
          {LINKS.map((l: any) =>
            l.section ? (
              <div className="bo-sectiontitle" style={{ margin: "14px 0 4px", fontSize: 11 }} key={l.section}>{l.section}</div>
            ) : (
              <Link key={l.id} className={"bo-navitem" + (loc.pathname === l.href ? " active" : "")} to={l.href}>
                <svg viewBox="0 0 24 24">{l.icon}</svg>
                {l.label}
                <span className="chev">›</span>
              </Link>
            ),
          )}
          <div className="foot">Integration concept — simulation on sandbox rails.<br />Not an official PayPal product.</div>
        </nav>
        <main className="main">
          <div className="content">
            <Outlet />
          </div>
        </main>
      </div>
    </>
  );
}
