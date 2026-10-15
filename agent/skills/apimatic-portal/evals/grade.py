#!/usr/bin/env python3
"""Grade all apimatic-portal evals against their assertions from evals.json."""

import json
import os
import re

WORKSPACE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "workspace")
EVALS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "evals.json")

with open(EVALS_FILE) as f:
    evals_data = json.load(f)

def normalize(s):
    """Lowercase and use forward slashes, so `src\\content` on Windows matches `src/content`."""
    return s.lower().replace("\\", "/")

def check_assertion(text, assertion):
    t = assertion["type"]
    v = assertion["value"]
    text_lower = normalize(text)

    if t == "contains":
        passed = normalize(v) in text_lower
        evidence = f"Found '{v}'" if passed else f"NOT FOUND: '{v}'"
    elif t == "contains_any":
        matched = [item for item in v if normalize(item) in text_lower]
        passed = len(matched) > 0
        evidence = f"Found: {matched}" if passed else f"NONE FOUND: {v}"
    elif t == "not_contains":
        passed = normalize(v) not in text_lower
        evidence = f"Correctly absent: '{v}'" if passed else f"SHOULD NOT CONTAIN: '{v}'"
    elif t == "not_contains_any":
        found = [item for item in v if normalize(item) in text_lower]
        passed = len(found) == 0
        evidence = f"Correctly absent" if passed else f"SHOULD NOT CONTAIN: {found}"
    else:
        passed = False
        evidence = f"Unknown assertion type: {t}"

    return passed, evidence

total_assertions = 0
total_passed = 0
results_by_eval = []
failed_evals = []

for eval_item in evals_data["evals"]:
    eval_id = eval_item["id"]
    response_path = os.path.join(WORKSPACE, f"eval-{eval_id}-response.md")

    if not os.path.exists(response_path):
        print(f"\n=== EVAL {eval_id} === MISSING response file: {response_path}")
        failed_evals.append(eval_id)
        continue

    with open(response_path) as f:
        response_text = f.read()

    assertions = eval_item.get("assertions", [])
    results = []
    eval_passed = 0
    for assertion in assertions:
        passed, evidence = check_assertion(response_text, assertion)
        results.append({
            "id": assertion["id"],
            "passed": passed,
            "evidence": evidence
        })
        total_assertions += 1
        if passed:
            total_passed += 1
            eval_passed += 1

    pass_rate = eval_passed / len(assertions) if assertions else 1.0
    results_by_eval.append({
        "id": eval_id,
        "prompt": eval_item["prompt"][:80],
        "pass_rate": pass_rate,
        "results": results
    })

    status = "✓" if pass_rate == 1.0 else ("~" if pass_rate >= 0.5 else "✗")
    print(f"\n{status} EVAL {eval_id}: {eval_item['prompt'][:60]}...")
    for r in results:
        sym = "✓" if r["passed"] else "✗"
        print(f"   {sym} {r['id']}: {r['evidence']}")
    print(f"   Pass rate: {pass_rate:.0%} ({eval_passed}/{len(assertions)})")

print(f"\n{'='*60}")
print(f"OVERALL: {total_passed}/{total_assertions} assertions passed ({total_passed/total_assertions:.0%})")

# Summary of failing evals
failing = [e for e in results_by_eval if e["pass_rate"] < 1.0]
if failing:
    print(f"\nFAILING EVALS ({len(failing)}):")
    for e in failing:
        failing_assertions = [r for r in e["results"] if not r["passed"]]
        print(f"  Eval {e['id']}: {e['pass_rate']:.0%} — failing: {[r['id'] for r in failing_assertions]}")
else:
    print("\nAll evals passed!")

# Write results JSON
results_out = {
    "total_passed": total_passed,
    "total_assertions": total_assertions,
    "pass_rate": total_passed / total_assertions if total_assertions else 0,
    "evals": results_by_eval
}
out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results.json")
with open(out_path, "w") as f:
    json.dump(results_out, f, indent=2)
print(f"\nDetailed results written to: {out_path}")
