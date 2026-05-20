# grove

A local CLI tool that reads your git branches and GitHub PR state to render a
dependency tree of stacked PRs — so you can see at a glance which PR to send
for review next.

GitHub's PR list is flat. Branch names don't tell you the order. Grove fixes that.

![grove output](./docs/screenshot-v0.1.2-f8e922.svg)

## How it works

Grove combines two sources of truth:

- **GitHub PR metadata** — fetched via the GitHub API using your existing `gh` CLI auth. Each PR's `base.ref` (the branch it's targeting) defines the parent-child relationship.
- **Local git state** — used to detect whether a branch needs rebasing (i.e. the parent branch's tip is no longer in the branch's history).

The tree is built from `base.ref` chains. If PR B targets branch A, B is a child of A. If both target `master`, they're siblings. This reflects the actual merge dependency — not just naming conventions.

### Status icons

| Icon | Meaning |
|------|---------|
| ✅   | Merged |
| ●    | Open |
| ◐    | Draft |
| ○    | Local only (no PR yet) |
| ⚠    | Needs rebase |
| ◀    | Your current branch |

### Annotations

| Label | Meaning |
|-------|---------|
| `← request review` | All ancestor PRs are merged — this one is ready |
| `← open PR` | Local branch with no PR yet, ancestors are merged |
| `blocked` | Has at least one unmerged ancestor |
| `⚠ needs rebase` | Parent branch has moved; branch needs rebasing |
| `· not local` | Branch exists on GitHub but isn't checked out locally |

## Installation

**Requirements:** Node.js 18+, [GitHub CLI (`gh`)](https://cli.github.com/) authenticated.

```bash
npm install -g @deviationist/grove
```

Then run from anywhere inside a git repository:

```bash
grove
```

### Local development / forking

```bash
git clone git@github.com:deviationist/grove.git
cd grove
npm install
npm run build
npm install -g .
```

## Usage

```
grove [filter] [--all] [--author <login>] [--open] [--json] [--table] [--watch] [--no-checks]
```

### Default — your PRs only

```bash
grove
```

Shows only branches whose PR was authored by you (detected via `gh api user`).
The header shows `@your-login` to confirm the filter is active.

### Filter by keyword

```bash
grove PLAT-12
```

Filters branches by name or PR title (case-insensitive). Works alongside
author filtering.

### Show all authors

```bash
grove --all
```

Disables the author filter — shows every local branch and its PR state.

### Filter by a specific author

```bash
grove --author bob
```

Shows branches whose PRs were opened by `bob`.

### Combine filters

```bash
grove --author bob PLAT-12
```

### Live watch mode

```bash
grove --watch
```

Re-polls GitHub every 30 seconds and re-renders the tree whenever state
changes. Useful to keep in a side terminal while you work.

Change the polling interval:

```bash
grove --watch --interval 10
```

Combine with `--json` for a live NDJSON stream (one JSON object per line,
emitted whenever the stack state changes) — the format agent processes can
`readline` and react to:

```bash
grove --watch --json
grove --watch --json --interval 10
```

### Open the next ready PR in your browser

```bash
grove --open
```

Opens the first PR that is ready for review (all ancestors merged) directly
in your browser.

### Machine-readable JSON output

```bash
grove --json
```

Outputs a structured JSON snapshot instead of the terminal visualisation.
Each branch includes an `action` field that collapses all signals (stack
position, rebase state, PR presence) into a single directive:

| Action | Meaning |
|--------|---------|
| `needs_rebase` | Parent has moved — rebase before anything else |
| `fix_ci` | CI is failing — fix it before requesting review |
| `address_review` | A reviewer has requested changes |
| `request_review` | All ancestors merged, CI passing — send for review |
| `create_pr` | All ancestors merged, no PR yet — open one |
| `blocked` | Has at least one unmerged ancestor |
| `merged` | Already merged |

The `prioritized` array is sorted by that order — index 0 is always the
highest-leverage action right now.

Combine with other flags to scope the output:

```bash
grove --json --all          # all authors
grove --json PLAT-12        # filtered by keyword
grove --json | jq '.prioritized[0]'   # top action
```

See [AGENTS.md](./AGENTS.md) for how to use this output as LLM context.

### rtk integration

Grove is natively compatible with [rtk](https://github.com/rtk-ai/rtk), the
token-optimizing CLI proxy.

When grove detects it is running as a child of `rtk`, it **automatically
switches to minified JSON output** — no flags needed:

```bash
rtk grove          # minified JSON, auto-detected
grove --json       # same output, explicit
grove --json --pretty   # indented JSON for human reading
```

Detection uses the parent process ID (`process.ppid`) — `/proc` on Linux,
`ps` on macOS — with a fallback to the `RTK` environment variable. Explicit
visual flags (`--table`, `--watch`) always override auto-detection.

The result: `rtk grove` gives rtk a single compact JSON line it can parse,
summarise, or pass straight through — no ANSI codes, no box-drawing, just
structured data.

### Skipping CI and review checks

By default grove fetches CI state and review status for each open branch,
which makes the `action` field in `--json` accurate. To skip this (faster,
works without network for the check APIs):

```bash
grove --no-checks
```

Or opt out permanently for a repo by creating `.grove.json` at the root:

```json
{
  "checks": false
}
```

The `--no-checks` flag always overrides the config file.

### Bordered table output

```bash
grove --table
```

Switches from the default tree view to a box-bordered table with column
headers (`BRANCH / PR / STATUS / ACTION`). Useful if you prefer a more
structured layout or are copying output into a document.

Set it permanently for a repo via `.grove.json`:

```json
{
  "format": "table"
}
```

`--table` always overrides the config file. Both formats support all other
flags (`--all`, `--author`, `--watch`, `--no-checks`, etc.).

## Understanding the tree

The dependency tree is built entirely from **GitHub's `base.ref`** — the target
branch of each PR. This is the most reliable source because it reflects the
actual merge order:

- If PR B targets branch A on GitHub → B is shown as a child of A
- If PR B targets `master` → B is a direct child of trunk

This means that if you open all your PRs targeting `master` directly (a common
workflow), grove will show them as siblings even if the branches are git-stacked
on each other. To get a nested tree, the PRs themselves need to target the
previous branch in the stack as their base.

### Needs rebase detection

A branch is flagged `⚠ needs rebase` when `git merge-base(branch, parent)` does
not equal the parent's current tip — meaning the parent has new commits the
branch hasn't incorporated. This check runs in parallel for all branches.

### Remote-only branches

If one of your local PRs targets a branch you don't have checked out locally
(e.g. a shared base branch opened by you on GitHub), grove will automatically
detect it, fetch its PR metadata, and include it as a `· not local` node in
the tree so the stack structure is preserved.

## Alternatives

Several tools exist for working with stacked PRs. Grove's niche is **read-only local visualisation** — no account, no workflow changes, just a clear picture of what you already have.

| Tool | Type | Account required | Manages stacking | Open source |
|------|------|-----------------|-----------------|-------------|
| **grove** | Local CLI | No | No — view only | Yes |
| [Graphite](https://graphite.dev) | SaaS + CLI | Yes | Yes | No |
| [Aviator](https://aviator.co) | SaaS | Yes | Yes | No |
| [spr](https://github.com/ejoffe/spr) | Local CLI | No | Yes | Yes |
| [ghstack](https://github.com/ezyang/ghstack) | Local CLI | No | Yes | Yes |
| [git-branchless](https://github.com/arxanas/git-branchless) | Local CLI | No | Yes | Yes |
| GitHub native | Web | — | No | — |

**Graphite and Aviator** are full stacking platforms — they automate rebasing, update base branches, and provide dashboards. Powerful, but require a SaaS account and adopting their specific workflow.

**spr and ghstack** are local CLI tools that actively *manage* your stack — pushing commits, updating branches, and syncing with GitHub. They require you to work through their tooling rather than plain `git`.

**git-branchless** is a powerful local tool focused on commit-graph workflows. It can model stacks but has a steeper learning curve and a different mental model than branch-based GitHub PRs.

**grove** does none of the managing — it only reads. The upside is that it works with however you already structure your branches and PRs, requires no signup, and imposes no new workflow. If you want to *see* your stack clearly without changing how you work, that's what grove is for.

## Tech stack

- **Node.js + TypeScript**, bundled with `esbuild`
- `chalk` — terminal colours
- GitHub REST API via `fetch` + `gh auth token` for authentication
- No TUI framework — plain stdout rendering

## Zero config

Grove detects everything from your environment:

- **Repo** — parsed from `git remote get-url origin`
- **Trunk** — auto-detected (`main`, `master`, or `develop`)
- **Auth** — uses your existing `gh` CLI session, no new login required
- **Current branch** — highlighted with `◀`

No config files, no telemetry, no third-party services.
