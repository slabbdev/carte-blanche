# apimatic-sdk evals

`evals.json` holds the prompts and the assertions for each one. `grade.py` scores the agent's responses against those assertions.

## Files in `workspace/`

`workspace/` is git-ignored. For each eval `<id>`, you need:

| File | What it is | Used by |
|---|---|---|
| `eval-<id>-transcript.jsonl` | The agent's run, from `claude -p ... --output-format stream-json --verbose` | `ran_command` assertions (did the agent actually run the command, not just suggest it) |
| `eval-<id>-response.md` | Everything the agent showed the user: its text and the shell commands it ran. `extract_responses.py` builds it from the transcript | All other assertions |

An eval with no response file fails every one of its assertions and is listed under `MISSING RESPONSES`.

## Environment

Results depend on the machine, so record these with every run:

- **CLI version** (`apimatic --version`). The evals target `@apimatic/cli@beta`. Change tracking (`--track-changes`, `--skip-changes`, `sdk save-changes`) isn't in every v2 beta. Evals 6 and 9–12 pass either way: the agent runs the change-tracking commands if `apimatic sdk generate --help` lists them, and otherwise tells the user they aren't available.
- **Authentication.** Sign in (`apimatic auth login`) before the run. Eval 0 is the exception: it expects the agent to log in, so run `apimatic auth logout` before that eval.
- **Commands are executed, not just described.** Let the agent run shell commands (`--allowedTools "Bash,PowerShell"`) so `ran_command` assertions can pass.
- **Fixtures.** Run each eval in its own empty directory. The project folders that prompts mention don't need to exist; the assertions check what the agent says and runs. Eval 51 is the exception: create the broken `src/spec/openapi.yaml` that its `expected_output` describes in the run directory first.
- **The skill is installed** where Claude Code finds it from any directory, such as `~/.claude/skills/apimatic-sdk` (see the [repository README](../../../README.md#option-3--manual-copy)).

## Run

From `skills/apimatic-sdk/evals` in a Bash shell:

```bash
mkdir -p workspace
for id in $(python -c "import json; print(*[e['id'] for e in json.load(open('evals.json', encoding='utf-8'))['evals']])"); do
  prompt=$(python -c "import json, sys; print(next(e['prompt'] for e in json.load(open('evals.json', encoding='utf-8'))['evals'] if e['id'] == int(sys.argv[1])))" "$id")
  run_dir=$(mktemp -d)
  (cd "$run_dir" && claude -p "$prompt" --output-format stream-json --verbose --allowedTools "Bash,PowerShell") > "workspace/eval-$id-transcript.jsonl"
done
python extract_responses.py
python grade.py
```

To rerun a single eval, run the loop body for that `id`, then `extract_responses.py` and `grade.py` again.

`grade.py` prints each assertion's result and writes `results.json` next to it.
