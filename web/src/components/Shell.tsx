import { useEffect, useState } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { api } from "../api";

const LINKS = [
  { id: "console", href: "/", label: "Agent console", icon: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /></> },
  { section: "INTEGRATIONS" },
  { id: "planner", href: "/planner", label: "Journey planner", icon: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 11h18" /></> },
  { id: "oversight", href: "/oversight", label: "My agents (oversight)", icon: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="3" /></> },
  { id: "rc", href: "/dashboard", label: "Resolution Center", icon: <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /> },
  { id: "verify", href: "/verify", label: "Public verification", icon: <><path d="M9 12l2 2 4-5" /><circle cx="12" cy="12" r="9" /></> },
  { id: "docs", href: "/docs", label: "API", icon: <path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12" /> },
] as const;

export default function Shell() {
  const loc = useLocation();
  const [me, setMe] = useState<{ sub: string } | null | "anon">(null);

  useEffect(() => {
    api<{ sub: string }>("/api/auth/me").then(setMe).catch(() => setMe("anon"));
  }, [loc.pathname]);

  if (me === "anon") return <Navigate to={"/login?next=" + encodeURIComponent(loc.pathname)} replace />;

  return (
    <>
      <div className="topbar">
        <Link className="wordmark" to="/"><span className="pay">Carte</span><span className="pal">Blanche</span></Link>
        <span className="account"><b>{me ? me.sub : "…"}</b> <span className="envchip">SANDBOX</span></span>
        <div className="top-right">
          <button className="ghost" id="signout" onClick={async () => {
            try { await api("/api/auth/logout", { method: "POST" }); } catch { /* gone either way */ }
            window.location.href = "/login";
          }}>Sign out</button>
          <span className="avatar">CB</span>
        </div>
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
