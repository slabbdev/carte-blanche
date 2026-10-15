/**
 * Shared app chrome — the tiny runtime part only. The sidebar itself is
 * injected into every page at BUILD time (scripts/copy-web.mjs), so navigation
 * is present at first paint: no flash, no layout jump between pages.
 * This script only greets the logged account (async by nature).
 */
(function () {
  function init() {
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
