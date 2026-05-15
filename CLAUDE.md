# grove — stacked branch visualizer

A local CLI tool that reads your git graph and GitHub PR state to render a
dependency tree of stacked branches, highlighting exactly which PR to send for
review next.

## File structure

```
grove/
├── src/
│   ├── index.ts     # CLI entry point, arg parsing
│   ├── git.ts       # branch discovery, merge-base logic
│   ├── github.ts    # PR metadata via GitHub REST API
│   ├── tree.ts      # build parent-child tree
│   └── render.ts    # chalk-based terminal output
├── package.json
├── tsconfig.json
└── .gitignore
```

## Tech stack

- **Node.js + TypeScript**, bundled with `esbuild` or `@vercel/ncc`
- `chalk` — terminal colors
- `@octokit/rest` or plain `fetch` — GitHub REST API
- No TUI framework — plain stdout string rendering

## Target output

```
grove  ·  acme/my-app
──────────────────────────────────────────────────────
main
├── FEAT-101-auth-login-page                #101 ✅ merged
├── FEAT-101-auth-signup-form               #102 ✅ merged
└── FEAT-101-auth-password-reset            #103 ◐ draft   ← request review
    └── FEAT-101-auth-password-reset-tests  #104 ◐ draft   blocked
        └── FEAT-101-auth-email-integration #105 ◐ draft   blocked
──────────────────────────────────────────────────────
1 ready for review  ·  2 blocked  ·  2 merged
```

## Color scheme

- ✅ merged        → green
- ◐  draft         → grey
- ●  open          → blue
- ⚠  needs rebase  → yellow
- ←  action item   → bold white

## Branch parent-detection algorithm

The core challenge: given N local branches, find each branch's closest ancestor branch.

1. List all local branches with their tip commit hashes (`git branch --format='%(refname:short) %(objectname)'`)
2. Identify the trunk branch (`main` or `master` — check which exists)
3. For each non-trunk branch **B**:
   - For each other branch **C**: check if C is an ancestor of B using `git merge-base --is-ancestor C B`
   - Among all ancestor branches, pick the **closest** one: `git rev-list --count C..B` — minimum count = closest parent
4. Any branch with no ancestor branch (other than trunk) is a direct child of trunk

**Why this works:** In a stack like `main → a → b → c`, when processing `c`:
- `main` is an ancestor (distance: large)
- `a` is an ancestor (distance: medium)
- `b` is an ancestor (distance: small — wins)

**Edge cases:**
- Branches not derived from trunk → treated as orphans (skipped or shown separately)
- Two branches at same commit → tiebreak alphabetically
- Needs-rebase detection: after determining parent, check if `merge-base(B, parent)` == `tip(parent)` — if not, parent has moved and B needs rebase

**Complexity:** O(N²) git subprocess calls — acceptable for typical branch counts (10–50).

## Priority logic

- **ready for review**: all ancestor branches are merged — show `← request review`
- **blocked**: has at least one unmerged ancestor
- **needs rebase**: `merge-base(B, parent) != tip(parent)` — flag in yellow
- **merged**: PR state is merged on GitHub

## Constraints

- Completely local — no telemetry, no third-party SaaS, no new auth
- Uses `gh auth token` for GitHub API calls
- Detects `owner/repo` from `git remote get-url origin`
- Works from any subdirectory inside a git repo
- Zero-config by default

## Nice-to-have (implement only if core is clean)

- `grove --restack` — runs `git rebase <parent>` up the chain automatically
- `grove --open` — opens the "ready for review" PR in the browser
- Auto-detect and display all branches in the repo, not just the current stack

## Implementation order

1. `git.ts` — branch discovery + parent-detection algorithm
2. `github.ts` — PR metadata fetch
3. `tree.ts` — build typed tree structure
4. `render.ts` — terminal output
5. `index.ts` — wire everything together + CLI args

## Deliverables

- Working `grove` command
- `README.md` for human users (installation, usage, how it works)
