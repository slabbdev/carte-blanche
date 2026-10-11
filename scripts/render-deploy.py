#!/usr/bin/env python3
"""Deploy carte-blanche to Render via API. Secrets read from .env, never printed."""
import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = open(os.path.expanduser("~/.zcode/secrets/render-api.key")).read().strip()
API = "https://api.render.com/v1"


def call(method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
        method=method,
    )
    try:
        raw = urllib.request.urlopen(req, timeout=60).read()
        return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code} on {method} {path}: {e.read().decode()[:600]}", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    env = {}
    for line in open(os.path.join(ROOT, ".env")):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k] = v

    owner_id = call("GET", "/owners")[0]["owner"]["id"]
    print(f"owner  : {owner_id}")

    CREATE_BODY = {
        "type": "web_service",
        "name": "carte-blanche",
        "ownerId": owner_id,
        "repo": "https://github.com/slabbdev/carte-blanche",
        "branch": "main",
        "autoDeployTrigger": "commit",
        "serviceDetails": {
            "runtime": "node",
            "region": "frankfurt",
            "plan": "0.5c-512mb",
            "numInstances": 1,
            "healthCheckPath": "/healthz",
            "envSpecificDetails": {
                "buildCommand": "npm ci && npm run build",
                "startCommand": "npm start",
            },
        },
        "envVars": [
            {"key": "NODE_VERSION", "value": "22"},
            {"key": "PAYPAL_MODE", "value": "sandbox"},
            {"key": "PAYPAL_ENV", "value": "sandbox"},
            {"key": "PAYPAL_CLIENT_ID", "value": env["PAYPAL_CLIENT_ID"]},
            {"key": "PAYPAL_CLIENT_SECRET", "value": env["PAYPAL_CLIENT_SECRET"]},
        ],
    }

    existing = {s["service"]["name"]: s["service"] for s in call("GET", "/services?limit=50")}
    svc = existing.get("carte-blanche")
    if svc:
        print(f"service: {svc['id']} (exists)")
    else:
        created = call("POST", "/services", CREATE_BODY)
        svc = created.get("service", created)
        print(f"created: {svc['id']}")
    svc_id = svc["id"]

    def unwrap_deploys(raw):
        items = raw if isinstance(raw, list) else raw.get("deploys", [])
        return [d.get("deploy", d) for d in items]

    recent = call("GET", f"/services/{svc_id}/deploys?limit=5")
    in_flight = [d for d in unwrap_deploys(recent)
                 if d.get("status") in ("created", "build_in_progress", "update_in_progress", "pre_deploy_in_progress")]
    if in_flight:
        deploy_id = in_flight[0]["id"]
        print(f"deploy : {deploy_id} (already in flight)")
    else:
        call("POST", f"/services/{svc_id}/deploys", {})
        time.sleep(5)
        deploys = unwrap_deploys(call("GET", f"/services/{svc_id}/deploys?limit=5"))
        if not deploys:
            print("no deploys visible after trigger")
            sys.exit(1)
        deploy_id = deploys[0]["id"]
        print(f"deploy : {deploy_id} (newest)")

    for i in range(1, 41):
        time.sleep(12)
        status = call("GET", f"/services/{svc_id}/deploys/{deploy_id}")["status"]
        print(f"  [{i:02d}] {status}")
        if status == "live":
            break
        if status.endswith("_failed") or status == "canceled":
            sys.exit(1)

    detail = call("GET", f"/services/{svc_id}")
    url = (detail.get("serviceDetails") or {}).get("url", "")
    print(f"live   : {url}")
    for i in range(1, 11):
        try:
            with urllib.request.urlopen(f"{url}/healthz", timeout=90) as r:
                print(f"healthz: {r.status} {r.read().decode()[:120]}")
                break
        except Exception as e:
            print(f"healthz attempt {i}: {e}")
            time.sleep(10)


if __name__ == "__main__":
    main()
