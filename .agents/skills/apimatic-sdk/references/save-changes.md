# Saving SDK Customizations

Use this after the user has made their custom changes to a generated SDK and wants to preserve them across future regenerations.

Only use this file after the Change Tracking Availability Check in `SKILL.md` has confirmed that the installed CLI supports change tracking (`apimatic sdk generate --help` lists `--track-changes`). If it does not, `sdk save-changes` is not available — follow the instructions in that check instead.

## Step 1: Determine flags

**If `sdk generate` was already run in this session**, carry the values forward — do not ask again:

- `--input` from generate → use the same value for `--input`. Omit if it was the default.
- `--destination` from generate → use the same value for `--sdk`. Omit if destination was the default.
- `--api-version` from generate → use the same value for `--api-version`. Omit if it was not used.

**If starting save-changes without a prior generate step**, collect only what is unknown:

- **Input directory (`--input`)** — if you do not know where the project root is, ask: "Is your project in the current directory, or is it somewhere else?"
  - Current directory → omit `--input`.
  - Different path → add `--input=<path>` pointing to the parent directory that contains `src/`.

- **SDK path (`--sdk`)** — if you do not know where the SDK lives, ask: "Is the SDK at the default location, or was it generated to a custom path?"
  - Default location → omit `--sdk`.
  - Custom path → add `--sdk=<path>` pointing to the folder containing the updated SDK.

- **API version (`--api-version`)** — do not ask. Only add `--api-version=<version>` if the user mentions a specific version themselves.

## Step 2: Run save-changes

Run the command with the applicable flags:

```
apimatic sdk save-changes --language=<language>
```

Examples with optional flags:

```
# Non-default input directory
apimatic sdk save-changes --language=typescript --input=./my-project

# SDK at a custom path
apimatic sdk save-changes --language=typescript --sdk=./output/my-sdk

# Specific API version (only when user mentioned it)
apimatic sdk save-changes --language=typescript --api-version=v2
```

---

## Step 3: Verify and next steps

After saving, ask the user:

"Do you want to regenerate the SDK now to confirm your customizations are applied correctly?"

- **Yes** → run:

  ```
  apimatic sdk generate --language=<language>
  ```

- **No** → inform the user: "Your customizations are saved. The next time you run `sdk generate` for this language, they'll be reapplied automatically."

---

## Reverting customizations

**Preview the SDK without customizations** (non-destructive — saved state is untouched):

```
apimatic sdk generate --language=<language> --skip-changes
```

**Revert a specific customization** — undo the change in the generated SDK files, then save the updated state:

```
apimatic sdk save-changes --language=<language>
```

This overwrites the previously saved state so the reverted change is no longer reapplied.

**Remove all customizations** — delete the language file (e.g., `.typescript`) from the `sdk-source-tree` folder in the input directory. The next `sdk generate` for that language will run without any customizations, and change tracking will need to be re-initialized with `--track-changes`.
