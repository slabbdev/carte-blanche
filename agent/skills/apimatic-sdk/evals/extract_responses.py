#!/usr/bin/env python3
"""Write workspace/eval-<id>-response.md for each workspace/eval-<id>-transcript.jsonl.

The response holds everything the agent showed the user, in order: each text block and
each shell command it ran (as a fenced code block). grade.py checks its assertions against it.
"""

import glob
import json
import os
import re

WORKSPACE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "workspace")

for transcript_path in sorted(glob.glob(os.path.join(WORKSPACE, "eval-*-transcript.jsonl"))):
    eval_id = re.search(r"eval-(\d+)-transcript\.jsonl$", transcript_path).group(1)
    parts = []
    with open(transcript_path, encoding="utf-8") as f:
        for line in f:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") != "assistant":
                continue
            content = event.get("message", {}).get("content", [])
            if not isinstance(content, list):
                continue
            for block in content:
                if block.get("type") == "text":
                    parts.append(block.get("text", ""))
                elif block.get("type") == "tool_use" and block.get("name") in ("Bash", "PowerShell"):
                    parts.append(f"```shell\n{block.get('input', {}).get('command', '')}\n```")

    response_path = os.path.join(WORKSPACE, f"eval-{eval_id}-response.md")
    with open(response_path, "w", encoding="utf-8") as f:
        f.write("\n\n".join(parts) + "\n")
    print(f"Wrote {response_path}")
