# Grove Roadmap

## Planned: `grove claim` — agent coordination

### Goal

Let agents (and humans) mark a branch as "in progress" so multiple actors
don't work on the same thing simultaneously. This is the step that turns
grove from a read-only world model into actual coordination infrastructure.

### Design

**Storage** — a local `.grove-claims.json` at the repo root (gitignored).
No server, no account, stays local.

```json
{
  "claims": {
    "feat/auth-login": {
      "claimedBy": "agent-1",
      "claimedAt": "2025-05-20T10:00:00Z",
      "note": "Fixing CI failure",
      "expiresAt": "2025-05-20T11:00:00Z"
    }
  }
}
```

**New commands**

```bash
grove claim <branch>               # claim a branch
grove claim <branch> --by agent-1  # claim on behalf of a named actor
grove claim <branch> --note "fixing CI"  # attach a note
grove claim <branch> --ttl 30      # auto-expire after 30 minutes (default: 60)
grove release <branch>             # release a claim
grove claims                       # list all active claims
```

**`--json` output** — adds `claimedBy: string | null` to each `JsonBranch`
so agents can check ownership before taking an action:

```json
{
  "branch": "feat/auth-login",
  "action": "fix_ci",
  "claimedBy": "agent-1"
}
```

**Terminal output** — shows a `⚑ agent-1` indicator on claimed branches
and a claimed count in the footer.

**Expiry** — claims auto-expire after a configurable TTL to prevent stale
locks from blocking work. Grove silently drops expired claims on each read.

### Implementation order

1. `src/claims.ts` — read/write/expire claims from `.grove-claims.json`
2. `grove claim <branch>` / `grove release <branch>` subcommands
3. Wire `claimedBy` into `--json` output
4. Wire claim indicator into terminal renderer
5. Add `.grove-claims.json` to `.gitignore` template (or warn if not ignored)
6. Update README and AGENTS.md

### Open questions

- Should `grove claim` (no branch arg) auto-claim the top unclaimed action?
- Should claims be shared across a team via a remote store, or always local?
  (Local first — keep it zero-config. Remote is a future opt-in.)
- Should the `--watch --json` NDJSON stream include claim change events?
