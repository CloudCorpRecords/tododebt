# tododebt

**Every repo has a TODO list. It is just scattered across the source, with no owner and no age.**

TODO, FIXME, HACK, and XXX comments are real commitments that nobody tracks. They pile up invisibly: a FIXME from two years ago reads exactly like one from yesterday, and a HACK that was meant to last a week quietly becomes load-bearing. tododebt inventories them. It walks a repo, records every marker with its file, line, and text, groups the counts by marker and by file, and, when git history is available, dates each marker with git blame so the oldest debt surfaces first. Debt becomes a list you can triage, not a vibe.

## Install

```bash
npx @reneturcios/tododebt scan
```

No install is required. Node 20 or newer.

## Usage

### CLI

```bash
# Scan the current directory
npx @reneturcios/tododebt scan

# Scan another path
npx @reneturcios/tododebt scan ~/src/my-repo

# Machine readable output
npx @reneturcios/tododebt scan ~/src/my-repo --json

# Print the version
npx @reneturcios/tododebt --version
```

Example output:

```text
tododebt scan .: DEBT
  DEBT: 6 marker(s) in 3 file(s): TODO 3, FIXME 1, HACK 1, XXX 1; aged 4, unaged 2. Oldest: src/a.ts:3 since 2024-03-15.
  counts: total 6, TODO 3, FIXME 1, HACK 1, XXX 1, files with debt 3, files scanned 42, files seen 42, aged 4, unaged 2
  findings (6):
    [HIGH] src/a.ts:3 MARKER-FIXME FIXME debt marker - // FIXME: this crashes on empty input (since 2024-03-15)
    [MEDIUM] src/a.ts:1 MARKER-TODO TODO debt marker - // TODO: wire up the cache
  DEBT: at least one debt marker was found. See findings above.
```

Exit codes: 0 when the verdict is NONE, 1 when the verdict is DEBT, 2 for usage errors. A reader that closes the output pipe early makes the process exit 141, never 0, so a truncated report never looks like a clean scan.

### MCP server

```bash
npx @reneturcios/tododebt mcp
```

Add to your MCP client config:

```json
{
  "mcpServers": {
    "tododebt": {
      "command": "npx",
      "args": ["-y", "@reneturcios/tododebt", "mcp"]
    }
  }
}
```

Tool: `scan_todo_debt(path)` returns the full report as JSON: the verdict, counts grouped by marker and by file, and every finding with file, line, rule, severity, and evidence.

## What it counts

| marker | rule | severity |
| --- | --- | --- |
| `FIXME` | `MARKER-FIXME` | high |
| `TODO` | `MARKER-TODO` | medium |
| `HACK` | `MARKER-HACK` | medium |
| `XXX` | `MARKER-XXX` | low |

Rules of the scan:

- Source files only: `.ts`, `.js`, `.mjs`, `.cjs`, `.tsx`, `.jsx`, `.py`, `.rb`, `.go`, `.rs`, `.java`, `.c`, `.cpp`, `.h`, and `.sh`. Markdown (`.md`) is excluded because docs legitimately discuss markers; counting docs would bury the code debt.
- The walker skips `node_modules`, `.git`, `dist`, and any directory named `test`, `tests`, or `fixtures`.
- Matching is case-sensitive uppercase with word boundaries. `TODOLIST` does not match, a lowercase `todo` in a comment does not match, and a method call like `.todo(` does not match. `NOTE` is not a marker.
- Each line contributes at most one finding. When a line holds two markers, the first (leftmost) one counts.
- Evidence is the trimmed line, capped at 200 chars, with the 1-based line number recorded. Findings are ordered deterministically by file, then line.
- Age: when the target sits inside a git repo, each finding is dated with `git blame` for its exact line, and the evidence gains a `(since YYYY-MM-DD)` suffix. The summary calls out the oldest aged finding. Blame is capped at 100 findings per run; findings past the cap, untracked files, and non-repo targets count as unaged. The report counts (`aged`, `unaged`) always add up to the total.

Verdict rules:

- **NONE**: zero findings. Exit code 0.
- **DEBT**: at least one finding. Exit code 1.

## Honesty note: strings count

A marker inside a string literal counts, exactly like a marker inside a comment. Static text cannot tell the difference between `"TODO: remove this"` as a deliberate note and the same words as data, and pretending otherwise would hide real debt. This applies to tododebt itself: scanning the tododebt source counts the marker words that appear in its own pattern definitions and comments. Every scanner in this family follows the same rule.

## Limits, stated plainly

- Uppercase markers only. Lowercase `todo`, mixed-case `Todo`, and every other marker word (including `NOTE`) are out of scope by design.
- Markdown is excluded, so debt written up in docs is invisible to this tool. That trade is deliberate: docs discuss markers far more often than they owe them.
- Caps are explicit, never silent: at most 5000 files are scanned and at most 512 KiB per file is read. Files past either cap are counted in the report (`filesSeen`, `oversizeSkipped`, `capped`) and named in the summary.
- Age is best-effort. Blame dates a line by its last commit, so a marker that survived a reformat carries the reformat date, not the day it was written. Blame stops after 100 findings per run, so very large debt piles have partial ages, and the counts say exactly how partial.
- The scan is static text matching. It does not parse any language, does not follow symlinked directories, and never executes anything in the scanned repo.
- Output is deterministic: sorted walks, sorted findings, no timestamps. Two runs over the same tree and the same git history produce the same report.

## License

MIT
