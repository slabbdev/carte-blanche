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
      <div className="topbar">
        <Link className="wordmark" to="/"><span className="pay">Carte</span><span className="pal">Blanche</span></Link>
        <span className="account">
          <b id="acctName">{displayName}</b>
          {typeLabel && <span className={"typechip " + (profile?.accountType ?? "")} onClick={() => setOpen((o) => !o)}>{typeLabel}</span>}
          <span className="envchip">SANDBOX</span>
        </span>
        <div className="top-right">
          {me === "anon"
            ? <Link className="ghost" style={{ display: "inline-flex", alignItems: "center", borderRadius: 19, padding: "8px 16px", fontSize: 13.5, background: "#fff", border: "1px solid #c8cdd6", color: "var(--text)", fontWeight: 600 }} to="/login">Log in</Link>
            : <>
              <button className="ghost" id="signout" onClick={async () => {
                try { await api("/api/auth/logout", { method: "POST" }); } catch { /* gone either way */ }
                window.location.href = "/login";
              }}>Sign out</button>
              <span className="avatar" onClick={() => setOpen((o) => !o)} style={{ cursor: "pointer" }}>
                {displayName.slice(0, 2).toUpperCase()}
              </span>
            </>}
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
        <nav className="sidebar">
          {LINKS.map((l: any) =>
            l.section ? (
              <div className="nav-section" key={l.section}>{l.section}</div>
            ) : (
              <Link key={l.id} className={"nav-item" + (loc.pathname === l.href ? " active" : "")} to={l.href}>
                <svg viewBox="0 0 24 24">{l.icon}</svg>
                {l.label}
              </Link>
            ),
          )}
          <div className="foot">Integration concept — simulation on sandbox rails. Not an official PayPal product.</div>
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
