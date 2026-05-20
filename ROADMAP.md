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

---

## Planned: API response caching

### Goal

Reduce latency and API usage, especially for `--watch` mode where the same
data is re-fetched every 30 seconds even when nothing has changed.

### Analysis of current fetch flow

- `fetchPRs` — sequential pagination loop (fine: almost always 1 page), then
  parallel fallback fetches for closed PRs ✓
- `fetchChecks` — fully parallel across all branches (`Promise.all`) ✓

The bottleneck is **no caching**: every run makes N × 2 API calls (CI + reviews
per branch) regardless of whether anything has changed since the last run.

### Design

**Two-layer caching:**

1. **TTL layer (30 s)** — if a cached entry is <30 s old, skip the request
   entirely and return the cached data. Aligns with the default `--watch`
   interval: subsequent polls within the same cycle are instant.

2. **ETag layer** — for entries older than the TTL, send `If-None-Match:
   <etag>` with the request. GitHub returns `304 Not Modified` (no body,
   faster) when nothing has changed; grove reuses the cached data and resets
   the TTL. On a `200`, the new data and fresh ETag replace the cache entry.

**Cache location** — `~/.grove-cache.json` (global, persists across sessions
and repos, keyed by full API URL). Entries older than 1 hour are evicted on
load to keep the file small.

**Opt-out** — `--no-cache` flag and `cache: false` in `.grove.json` bypass
both layers entirely (always fresh data, useful for debugging).

### Expected impact

- **First run**: no change (cold cache)
- **Repeat run within 30 s**: near-instant (all requests skipped)
- **`--watch` poll (second+)**: mostly `304` responses instead of full
  payloads — significantly faster, especially for large stacks
- **Rate limit**: GitHub `304` responses [do not count against the rate
  limit](https://docs.github.com/en/rest/overview/rate-limits), so
  ETag caching also reduces API quota usage

### Implementation order

1. `src/cache.ts` — TTL + ETag disk cache, `getCacheEntry`, `setCacheEntry`,
   `isCacheFresh`, `persistCache`, `setNoCache`
2. Wrap `ghFetch` in `github.ts` to use the cache (handles both array and
   object responses)
3. Wrap inline `fetch` calls in `fetchChecks` with the same cached fetch
4. Call `persistCache()` at the end of `buildStack` (batch disk writes)
5. Add `cache: boolean` to `config.ts` and `--no-cache` flag to `index.ts`
6. Update README with caching behaviour and opt-out docs

---

## Planned: `Depends-on:` — explicit cross-PR dependencies

### Goal

Allow users to express dependencies between PRs that git topology can't
infer — especially same-repo PRs with no ancestry relationship, and
cross-repo dependencies where a frontend PR is waiting on a backend PR
in a different repository.

### How it works

Grove parses `Depends-on:` lines from the PR description during its normal
GitHub API fetch (no extra requests needed — the body is already returned).

Add one or more lines anywhere in your PR description:

```
This PR adds the login page.

Depends-on: #101
Depends-on: deviationist/backend#234
```

Grove treats these as additional edges in the dependency graph, alongside
edges inferred from git ancestry and `base.ref`. The `blockedBy` field in
`--json` and the `blocked` annotation in the terminal view include them
transparently — consumers don't need to know how a dependency was detected.

### Supported syntax

```
Depends-on: #101                         # same-repo PR by number
Depends-on: owner/repo#456               # cross-repo PR
Depends-on: https://github.com/owner/repo/pull/456  # full URL
```

Parsing is case-insensitive (`depends-on:`, `Depends-On:`, `DEPENDS-ON:`
all work). Multiple `Depends-on:` lines are supported. Inline with other
text is fine — grove looks for the pattern anywhere in the body.

### Opt-out

This feature is **on by default** since it requires no setup and adds
information without changing existing behaviour for PRs that don't use it.

Disable it via `.grove.json`:

```json
{
  "dependsOn": false
}
```

Or per-invocation:

```bash
grove --no-depends-on
```

When disabled, grove ignores `Depends-on:` lines entirely and falls back
to git-only dependency inference.

### Cross-repo behaviour

For cross-repo dependencies, grove fetches the referenced PR's state
(open/merged/draft/closed) and surfaces it as a synthetic node in the
tree — similar to how remote-only branches are shown today. The node
shows the PR title, repo, and status, but has no local branch.

If the referenced PR is merged, the dependency is satisfied and the
depending branch is unblocked. If it's open or draft, the branch is
marked `blocked`.

### `--json` output

`blockedBy` entries for cross-repo dependencies include the full
`owner/repo#number` reference so agents can identify them:

```json
{
  "branch": "feat/login-page",
  "action": "blocked",
  "blockedBy": ["feat/auth-base", "deviationist/backend#234"]
}
```

### Implementation order

1. Parse `Depends-on:` lines from PR body in `github.ts` (`toPRInfo`)
2. Resolve same-repo references during tree build (`buildTree`)
3. Fetch cross-repo PR status for unresolved references
4. Wire into `blockedBy` in `json.ts` and `annotate` in `render.ts`
5. Add `dependsOn` config key to `config.ts` and `--no-depends-on` flag
6. Update README and AGENTS.md with syntax reference and opt-out docs

### Open questions

- Should grove warn (stderr) when a `Depends-on:` reference can't be
  resolved (deleted PR, wrong number, no API access)?
- Should cross-repo nodes be visually distinct in the terminal tree?
- Should `Depends-on:` in commit messages (not just PR body) also be parsed?
