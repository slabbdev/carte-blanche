import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

export default function Login() {
  const [params] = useSearchParams();
  const next = params.get("next")?.startsWith("/") && !params.get("next")?.startsWith("//") ? params.get("next") : null;
  const error = params.get("error");

  useEffect(() => {
    // already logged in? straight in
    fetch("/api/auth/me")
      .then((r) => { if (r.ok) window.location.href = next ?? "/"; })
      .catch(() => {});
  }, [next]);

  const href = "/api/auth/paypal/start" + (next ? "?next=" + encodeURIComponent(next) : "");

  return (
    <div className="login-body">
      <div className="wordmark" style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
        <span><span className="pay">Carte</span><span className="pal">Blanche</span></span>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2.6, textTransform: "uppercase", color: "var(--blue)", marginTop: 5 }}>for PayPal</span>
      </div>
      <div className="login-card">
        <h1>Log in</h1>
        <p className="sub">
          One PayPal account, the whole app — buyer of one dispute, seller of another, exactly like
          PayPal. The Resolution Center carries both faces.
        </p>
        <a className="paypal-btn" id="paypal-login" href={href}>
          <span className="pp-logo"><span className="pp-pay">Pay</span><span className="pp-pal">Pal</span></span>
          Log in with PayPal
        </a>
        <div className="errorline">{error ? "PayPal login: " + error : ""}</div>
        <div className="seat-hint">
          <b>BUSINESS</b> account → the seller's seat (Resolution Center, the merchant balance).{" "}
          <b>PERSONAL</b> account → the buyer's seat (agents, contestations, wallet money).
        </div>
        <p className="fineprint">
          Sandbox credentials come from your{" "}
          <a href="https://developer.paypal.com/dashboard/accounts" target="_blank" rel="noopener">PayPal developer account</a>.
          Receipt verification needs no account: <a href="/verify">verify a receipt publicly</a>.
        </p>
      </div>
      <p className="login-note">
        This is the REAL Connect-with-PayPal flow (OpenID Connect, sandbox). If PayPal sends you
        back with an error, it is shown above verbatim — usually the redirect URI needs registering
        on the app in the developer dashboard.
      </p>
    </div>
  );
}
