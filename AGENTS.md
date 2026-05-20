# AGENTS.md — Using grove as AI context

Grove's `--json` flag is designed to feed structured PR stack state into AI
assistants, so they can help you decide what to work on next without you having
to explain your current situation from scratch.

## Quick start

```bash
grove --json | claude "What should I work on next?"
```

Or inject it as context at the start of a coding session:

```bash
grove --json > /tmp/grove-context.json
# then reference it in your prompt
```

## JSON schema

```jsonc
{
  "repo": "owner/repo",
  "trunk": "main",
  "generatedAt": "<ISO 8601 timestamp>",

  "summary": {
    "total": 5,
    "merged": 2,
    "readyForReview": 1,
    "needsRebase": 1,
    "blocked": 1,
    "noPr": 0
  },

  // Flat list, sorted highest → lowest priority.
  // Index 0 is always the most urgent action.
  "prioritized": [
    {
      "branch": "feat/auth-login",
      "parent": "main",
      "pr": 101,
      "prTitle": "Add login page",
      "prUrl": "https://github.com/owner/repo/pull/101",
      "status": "open",       // "open" | "draft" | "merged" | "no-pr"
      "needsRebase": false,
      "ci": null,             // "passing" | "failing" | "pending" | null (future)
      "reviews": null,        // "approved" | "changes_requested" | "pending" | null (future)
      "action": "request_review",
      "blockedBy": []         // branch names of unmerged ancestors
    }
  ]
}
```

## The `action` field

This is the key field for AI decision-making. It is computed from the full
stack context, not just the branch in isolation:

| Value | What it means | Suggested next step |
|-------|--------------|---------------------|
| `needs_rebase` | Parent branch has new commits not in this branch | `git rebase <parent>` — do this first, it unblocks everything downstream |
| `request_review` | All ancestors merged, PR is open or draft | Mark ready for review and request reviewers |
| `create_pr` | All ancestors merged, no PR exists yet | Open a PR targeting the parent branch |
| `blocked` | One or more ancestors are not yet merged | Check `blockedBy` — work on those first |
| `merged` | PR is merged | Nothing to do |

Priority order: `needs_rebase` > `request_review` > `create_pr` > `blocked` > `merged`

## The `blockedBy` field

Lists the branch names (not PR numbers) of unmerged ancestors. Use this to
trace exactly what is in the way:

```bash
grove --json | jq '.prioritized[] | select(.action == "blocked") | {branch, blockedBy}'
```

## Example prompts

**What to work on next:**
```
Here is my current PR stack:
<paste grove --json output>

What should I work on first and why?
```

**Triage after CI failure:**
```
My CI just failed on feat/auth-signup. Here is my stack:
<paste grove --json output>

Which other branches does this failure block, and what's the fastest path
to getting everything green?
```

**End-of-day planning:**
```
I have 30 minutes before standup. Here is my PR stack:
<paste grove --json output>

What's the single highest-leverage thing I can finish in that time?
```

## Scripting

```bash
# Print only the top-priority action
grove --json | jq '.prioritized[0] | "\(.action) on \(.branch) (PR #\(.pr))"'

# List all branches that need a rebase
grove --json | jq '[.prioritized[] | select(.action == "needs_rebase") | .branch]'

# Count how many PRs are blocked
grove --json | jq '.summary.blocked'
```

## Claude Code hook (optional)

To automatically inject grove context into every Claude Code session, add
this to your `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "grove --json 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
```

This runs `grove --json` before each tool call and surfaces the output as
additional context — so Claude always knows your current stack state without
you having to paste it manually.

## Future fields

`ci` and `reviews` are present in the JSON but currently `null`. When grove
gains CI and review integration, these will be populated automatically and
the `action` field priority logic will incorporate them (e.g. `fix_ci` will
rank above `request_review`).
