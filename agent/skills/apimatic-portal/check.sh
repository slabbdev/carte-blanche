#!/usr/bin/env bash
# apimatic-portal skill regression checks (APIMatic CLI v2 / docs.apimatic.io/v4)
# Run from the repo root: bash skills/apimatic-portal/check.sh
#
# For AI evals, see: skills/apimatic-portal/evals/evals.json
# Run those via /skill-creator in the Claude interface.

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0
FAIL=0

pass() { echo "  PASS  $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }

separator() { echo ""; echo "--- $1 ---"; }

# upgrading-from-v1.md documents the v1 setup on purpose, so it is left out of the v2-only checks.
DOCS=("$SKILL_DIR/SKILL.md" "$SKILL_DIR/references/first-time-setup.md" "$SKILL_DIR/references/apimatic-json.md" "$SKILL_DIR/references/content-and-navigation.md" "$SKILL_DIR/references/context-plugins.md")

# Probe rather than `command -v`: Windows ships a python3 stub that only opens the Store.
PY=""
for candidate in python3 python; do
  if "$candidate" -c "import sys" > /dev/null 2>&1; then PY="$candidate"; break; fi
done
if [ -z "$PY" ]; then echo "python3 (or python) is required"; exit 1; fi

# ─────────────────────────────────────────────
# REMINDER: CLI v2 is pinned to the npm `beta` dist-tag. When CLI v2 goes GA, these checks
# must change with the skills — see "When APIMatic CLI v2 goes GA" in MAINTAINING.md.
separator "QUAL-01 — Node.js 24+ and @apimatic/cli@beta"

for f in "$SKILL_DIR/SKILL.md" "$SKILL_DIR/references/first-time-setup.md"; do
  if grep -qE "Node(\.js)? 24|v24" "$f"; then
    pass "$(basename "$f"): requires Node 24"
  else
    fail "$(basename "$f"): Node 24 requirement missing"
  fi
done

if grep -nE "Node(\.js)? (16|18|20)(\+| or (higher|later))|>= ?(16|18|20)\b|v20\.x" "${DOCS[@]}" > /dev/null 2>&1; then
  fail "An old Node.js requirement (16/18/20) is still present"
else
  pass "No old Node.js requirements"
fi

if grep -nE "@apimatic/cli(@latest)?([^@a-z/]|$)" "${DOCS[@]}" | grep -E "npm install|npx" > /dev/null 2>&1; then
  fail "An install/npx command uses @apimatic/cli without @beta"
  grep -nE "@apimatic/cli(@latest)?([^@a-z/]|$)" "${DOCS[@]}" | grep -E "npm install|npx" || true
else
  pass "Every install/npx command uses @apimatic/cli@beta"
fi

if grep -qF "npm install -g @apimatic/cli@beta" "$SKILL_DIR/SKILL.md"; then
  pass "SKILL.md: install command is npm install -g @apimatic/cli@beta"
else
  fail "SKILL.md: npm install -g @apimatic/cli@beta missing"
fi

# Security scanners (Gen Agent Trust Hub on skills.sh) rate the skill High Risk for privilege escalation
# when it tells the agent to run sudo.
if grep -rniE "\bsudo\b" "$SKILL_DIR" --include=*.md --include=*.mjs > /dev/null 2>&1; then
  fail "A skill file tells the agent to use sudo"
  grep -rniE "\bsudo\b" "$SKILL_DIR" --include=*.md --include=*.mjs || true
else
  pass "No sudo in skill files"
fi

# ─────────────────────────────────────────────
separator "QUAL-02 — CLI v2 flags documented"

for flag in "--destination" "--force" "--zip" "--auth-key" "--input"; do
  if grep -qF -- "$flag" "$SKILL_DIR/SKILL.md"; then
    pass "SKILL.md: portal generate $flag"
  else
    fail "SKILL.md: portal generate $flag missing"
  fi
done

if grep -qF "apimatic portal serve --open" "$SKILL_DIR/SKILL.md"; then
  pass "SKILL.md: portal serve --open fallback"
else
  fail "SKILL.md: portal serve --open fallback missing"
fi

if grep -qF "23513" "$SKILL_DIR/SKILL.md"; then
  pass "SKILL.md: default serve port 23513"
else
  fail "SKILL.md: default serve port 23513 missing"
fi

# ─────────────────────────────────────────────
separator "QUAL-03 — v2 configuration model"

for token in "src/apimatic.json" "nav.json" "front matter" "apimatic:api" "apimatic:sdks" "apimatic:plugin" "pageActions" "colorMode" "\"tabs\"" "/oauth/callback" "Hosting under a path"; do
  if grep -qF "$token" "$SKILL_DIR/SKILL.md"; then
    pass "SKILL.md mentions $token"
  else
    fail "SKILL.md does not mention $token"
  fi
done

if grep -qF "sample-docs-as-code-portal/archive/refs/heads/v2.zip" "$SKILL_DIR/references/first-time-setup.md"; then
  pass "first-time-setup.md downloads the v2 sample branch"
else
  fail "first-time-setup.md does not download the v2 sample branch"
fi

# v1 portal settings belong only in the upgrade guide (SKILL.md names some of them as unsupported).
V2_REFS=("$SKILL_DIR/references/apimatic-json.md" "$SKILL_DIR/references/content-and-navigation.md" "$SKILL_DIR/references/first-time-setup.md" "$SKILL_DIR/references/context-plugins.md")
for token in "toc.yml" "generatePortal" "portalSettings" "APIMATIC-BUILD.json"; do
  if grep -qF "$token" "${V2_REFS[@]}"; then
    fail "$token (CLI v1) appears in a v2 reference file"
  else
    pass "$token not used in v2 reference files"
  fi
done

# ─────────────────────────────────────────────
separator "QUAL-04 — Examples are valid"

EXAMPLE="$SKILL_DIR/examples/apimatic.json"
if "$PY" - "$EXAMPLE" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
assert d.get("schemaVersion") == 1, "schemaVersion must be 1"
langs = d.get("languages", {})
assert langs and set(langs) <= {"csharp", "python", "typescript"}, "languages must be a non-empty subset of csharp/python/typescript"
allowed = {"site", "brand", "navigation", "ai", "pluginUrl"}
assert set(d.get("portal", {})) <= allowed, "unknown portal keys"
PY
then
  pass "examples/apimatic.json is valid"
else
  fail "examples/apimatic.json is invalid"
fi

# `tabs` is read only in the root nav.json, and may not hold "..." or a name that is also in `pages`.
ROOT_NAV="$SKILL_DIR/examples/content/nav.json"
if "$PY" -c "import json,sys; d=json.load(open(sys.argv[1], encoding='utf-8')); t=d.get('tabs'); assert isinstance(t, list) and t; assert '...' not in t; assert not set(t) & set(d.get('pages', []))" "$ROOT_NAV"; then
  pass "examples/content/nav.json uses tabs"
else
  fail "examples/content/nav.json has no valid tabs list"
fi

while IFS= read -r nav; do
  if [ "$nav" = "$ROOT_NAV" ]; then allowed="{'title','pages','tabs'}"; else allowed="{'title','pages'}"; fi
  if "$PY" -c "import json,sys; d=json.load(open(sys.argv[1], encoding='utf-8')); assert set(d) <= $allowed; assert all('.' not in p.replace('...','') and '/' not in p for p in d.get('pages', []) + d.get('tabs', []))" "$nav"; then
    pass "$(realpath --relative-to="$SKILL_DIR" "$nav") is valid"
  else
    fail "$(realpath --relative-to="$SKILL_DIR" "$nav") is invalid"
  fi
done < <(find "$SKILL_DIR/examples/content" -name nav.json)

while IFS= read -r page; do
  if head -1 "$page" | grep -q '^---$' && sed -n '2,/^---$/p' "$page" | grep -q '^title:'; then
    pass "$(realpath --relative-to="$SKILL_DIR" "$page") has title front matter"
  else
    fail "$(realpath --relative-to="$SKILL_DIR" "$page") is missing title front matter"
  fi
done < <(find "$SKILL_DIR/examples/content" -name "*.md" -o -name "*.mdx")

# ─────────────────────────────────────────────
separator "QUAL-05 — AI eval spec integrity (evals.json)"

EVALS_FILE="$SKILL_DIR/evals/evals.json"

if [ -f "$EVALS_FILE" ]; then
  pass "evals.json exists"
  EVAL_COUNT=$("$PY" -c "import json,sys; d=json.load(open(sys.argv[1], encoding='utf-8')); print(len(d['evals']))" "$EVALS_FILE" 2>/dev/null || echo "0")
  if [ "$EVAL_COUNT" -ge 11 ]; then
    pass "evals.json: $EVAL_COUNT eval cases (expected >=11)"
  else
    fail "evals.json: only $EVAL_COUNT eval cases (expected >=11)"
  fi
  DUPES=$("$PY" -c "import json,sys,collections; d=json.load(open(sys.argv[1], encoding='utf-8')); c=collections.Counter(e['id'] for e in d['evals']); print(','.join(str(k) for k,v in c.items() if v>1))" "$EVALS_FILE")
  if [ -z "$DUPES" ]; then
    pass "evals.json: eval ids are unique"
  else
    fail "evals.json: duplicate eval ids: $DUPES"
  fi
  PROMPTS=$("$PY" -c "import json,sys; d=json.load(open(sys.argv[1], encoding='utf-8')); [print(e['prompt']) for e in d['evals']]" "$EVALS_FILE" 2>/dev/null || echo "")
  for pattern in "log in|authentication" "from scratch" "dev server|hot reload|live reload" "GitHub Actions|CI" "nav.json|sidebar" "logo|color" "APIMATIC-BUILD"; do
    if echo "$PROMPTS" | grep -qiE "$pattern"; then
      pass "evals.json: workflow covered ($pattern)"
    else
      fail "evals.json: workflow not covered ($pattern)"
    fi
  done
else
  fail "evals.json missing"
fi

# ─────────────────────────────────────────────
separator "QUAL-06 — scripts present"

for script in serve.mjs watchdog.mjs auth-login.mjs; do
  if [ -f "$SKILL_DIR/scripts/$script" ]; then
    pass "scripts/$script exists"
  else
    fail "scripts/$script missing"
  fi
done

for cmd in start restart status watch stop; do
  if grep -qE "case \"$cmd\"" "$SKILL_DIR/scripts/serve.mjs"; then
    pass "serve.mjs supports $cmd"
  else
    fail "serve.mjs does not support $cmd"
  fi
done

if grep -qF "The portal is running at" "$SKILL_DIR/scripts/serve.mjs"; then
  pass "serve.mjs detects the CLI v2 ready line"
else
  fail "serve.mjs does not detect the CLI v2 ready line"
fi

# ─────────────────────────────────────────────
separator "QUAL-07 — Path A onboarding flow markers"

for marker in "node --version" "npm install -g @apimatic/cli@beta" "serve.mjs start" "AskUserQuestion" "shut down the portal"; do
  if grep -qF "$marker" "$SKILL_DIR/references/first-time-setup.md"; then
    pass "first-time-setup.md contains '$marker'"
  else
    fail "first-time-setup.md missing '$marker'"
  fi
done

# ─────────────────────────────────────────────
separator "All reference files exist and are linked from SKILL.md"

REFS=("first-time-setup.md" "apimatic-json.md" "content-and-navigation.md" "context-plugins.md" "upgrading-from-v1.md")
for ref in "${REFS[@]}"; do
  if [ -f "$SKILL_DIR/references/$ref" ] && grep -qF "references/$ref" "$SKILL_DIR/SKILL.md"; then
    pass "references/$ref exists and is linked"
  else
    fail "references/$ref missing or not linked from SKILL.md"
  fi
done

# ─────────────────────────────────────────────
echo ""
echo "════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "════════════════════════════════════"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "REGRESSION DETECTED — $FAIL check(s) failed. Review output above."
  exit 1
else
  echo "All checks passed."
  exit 0
fi
