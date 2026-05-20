import { execFile } from 'child_process';
import {
  getRepoRoot,
  getRemoteUrl,
  parseOwnerRepo,
  getTrunk,
  getLocalBranches,
  getCurrentBranch,
  Branch,
} from './git';
import { fetchPRs, fetchCurrentUser, fetchChecks } from './github';
import { buildTree, TreeNode } from './tree';
import { render, RenderFormat } from './render';
import { buildJsonOutput } from './json';
import { loadConfig } from './config';
import { startSpinner } from './spinner';

const HELP = `
grove — stacked PR visualizer

USAGE
  grove [filter] [options]

OPTIONS
  --all               Show PRs from all authors (default: yours only)
  --author <login>    Show PRs from a specific GitHub user
  --open              Open the first ready-for-review PR in your browser
  --json              Output machine-readable JSON (LLM-friendly)
  --watch             Re-poll on an interval and emit on state changes
  --interval <secs>   Polling interval for --watch (default: 30)
  --no-checks         Skip CI and review state fetching (faster, offline-friendly)
  --table             Bordered table output instead of tree
  --help              Show this help message

FILTERING
  grove PLAT-12       Filter branches by name or PR title (case-insensitive)

EXAMPLES
  grove                          Your PRs in the current repo
  grove --all                    Everyone's PRs
  grove --author alice           Alice's PRs only
  grove PLAT-12                  Filter by keyword
  grove --open                   Open the first PR ready for review
  grove --json                   Machine-readable output for scripting/LLMs
  grove --watch                  Live terminal view, re-polls every 30s
  grove --watch --json           NDJSON stream for agent consumption
  grove --watch --interval 10    Re-poll every 10 seconds
`.trim();

function parseArgs(argv: string[]): {
  filter?: string;
  allAuthors: boolean;
  authorArg?: string;
  openReady: boolean;
  jsonOutput: boolean;
  watch: boolean;
  interval: number;
  noChecks: boolean;
  tableFormat: boolean;
  showHelp: boolean;
} {
  let filter: string | undefined;
  let allAuthors = false;
  let authorArg: string | undefined;
  let openReady = false;
  let jsonOutput = false;
  let watch = false;
  let interval = 30;
  let noChecks = false;
  let tableFormat = false;
  let showHelp = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') {
      showHelp = true;
    } else if (argv[i] === '--all') {
      allAuthors = true;
    } else if (argv[i] === '--open') {
      openReady = true;
    } else if (argv[i] === '--json') {
      jsonOutput = true;
    } else if (argv[i] === '--watch') {
      watch = true;
    } else if (argv[i] === '--no-checks') {
      noChecks = true;
    } else if (argv[i] === '--table') {
      tableFormat = true;
    } else if (argv[i] === '--interval' && argv[i + 1]) {
      const n = parseInt(argv[++i], 10);
      if (!isNaN(n) && n > 0) interval = n;
    } else if (argv[i] === '--author' && argv[i + 1]) {
      authorArg = argv[++i];
    } else if (!argv[i].startsWith('--')) {
      filter = argv[i];
    }
  }

  return { filter, allAuthors, authorArg, openReady, jsonOutput, watch, interval, noChecks, tableFormat, showHelp };
}

interface StackConfig {
  owner: string;
  repo: string;
  trunk: string;
  branches: Branch[];
  allAuthors: boolean;
  authorArg?: string;
  filter?: string;
  checksEnabled: boolean;
}

interface StackResult {
  roots: TreeNode[];
  nodeMap: Map<string, TreeNode>;
  authorFilter: string | undefined;
}

async function buildStack(config: StackConfig): Promise<StackResult> {
  const { owner, repo, trunk, branches, allAuthors, authorArg, filter, checksEnabled } = config;

  const branchNames = branches.map(b => b.name).filter(n => n !== trunk);
  const [prMap, currentUser] = await Promise.all([
    fetchPRs(owner, repo, branchNames),
    allAuthors ? Promise.resolve(undefined) : fetchCurrentUser(),
  ]);

  const authorFilter = allAuthors ? undefined : (authorArg ?? currentUser);

  const localNames = new Set(branches.map(b => b.name));
  const seen = new Set<string>();
  const remoteBranches: Branch[] = [];
  for (const pr of prMap.values()) {
    const ref = pr.baseRef;
    if (ref !== trunk && !localNames.has(ref) && !seen.has(ref) && prMap.has(ref)) {
      seen.add(ref);
      remoteBranches.push({ name: ref, tip: '', remote: true });
    }
  }

  const filteredLocal = branches.filter(b => {
    if (b.name === trunk) return true;
    const pr = prMap.get(b.name);
    if (authorFilter && pr && pr.authorLogin !== authorFilter) return false;
    if (filter) {
      const q = filter.toLowerCase();
      if (!b.name.toLowerCase().includes(q) && !(pr && pr.title.toLowerCase().includes(q))) {
        return false;
      }
    }
    return true;
  });

  const filteredLocalNames = new Set(filteredLocal.map(b => b.name));
  const seenRemote = new Set<string>();
  const filteredRemote: Branch[] = [];
  for (const b of filteredLocal) {
    if (b.name === trunk) continue;
    const pr = prMap.get(b.name);
    if (!pr) continue;
    const ref = pr.baseRef;
    if (ref !== trunk && !filteredLocalNames.has(ref) && !seenRemote.has(ref) && prMap.has(ref)) {
      seenRemote.add(ref);
      filteredRemote.push({ name: ref, tip: '', remote: true });
    }
  }

  const filteredBranches = [...filteredLocal, ...filteredRemote];
  const { roots, nodeMap } = await buildTree(filteredBranches, trunk, prMap);

  if (checksEnabled) {
    const checkNodes = [...nodeMap.values()]
      .filter(n => n.status !== 'merged' && !n.remote)
      .map(n => ({ branch: n.branch, prNumber: n.pr?.number ?? null }));

    if (checkNodes.length > 0) {
      const checksMap = await fetchChecks(owner, repo, checkNodes);
      for (const [branch, result] of checksMap) {
        const node = nodeMap.get(branch);
        if (node) {
          node.ciStatus = result.ci;
          node.reviewStatus = result.reviews;
        }
      }
    }
  }

  return { roots, nodeMap, authorFilter };
}

/** DFS to find the URL of the first PR that is ready for review. */
function findFirstReadyUrl(
  nodes: TreeNode[],
  nodeMap: Map<string, TreeNode>
): string | null {
  for (const node of nodes) {
    if (node.status !== 'merged' && node.pr) {
      let allMerged = true;
      let p = node.parent;
      while (p) {
        const parent = nodeMap.get(p);
        if (!parent) break;
        if (parent.status !== 'merged') { allMerged = false; break; }
        p = parent.parent;
      }
      if (allMerged) return node.pr.url;
    }
    const fromChildren = findFirstReadyUrl(node.children, nodeMap);
    if (fromChildren) return fromChildren;
  }
  return null;
}

function openUrl(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32'  ? 'start'
    : 'xdg-open';
  execFile(cmd, [url]);
}

async function runWatch(
  config: Omit<StackConfig, 'branches'>,
  jsonOutput: boolean,
  interval: number,
  format: RenderFormat,
): Promise<void> {
  const { owner, repo, trunk } = config;
  let prevSerialized: string | null = null;
  let firstRun = true;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const branches = getLocalBranches();
      const currentBranch = getCurrentBranch();
      const { roots, nodeMap, authorFilter } = await buildStack({ ...config, branches });

      if (jsonOutput) {
        const snapshot = buildJsonOutput(roots, nodeMap, trunk, `${owner}/${repo}`);
        const serialized = JSON.stringify(snapshot);
        if (serialized !== prevSerialized) {
          process.stdout.write(serialized + '\n');
          prevSerialized = serialized;
        }
      } else {
        const snapshot = buildJsonOutput(roots, nodeMap, trunk, `${owner}/${repo}`);
        const serialized = JSON.stringify(snapshot);
        const changed = serialized !== prevSerialized;

        if (changed || firstRun) {
          process.stdout.write('\x1B[2J\x1B[H'); // clear screen
          render(roots, trunk, `${owner}/${repo}`, nodeMap, currentBranch, config.filter, authorFilter, format);
          const ts = new Date().toLocaleTimeString();
          process.stdout.write(`\nWatching · updated ${ts} · every ${interval}s  Ctrl+C to stop\n`);
          prevSerialized = serialized;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (jsonOutput) {
        process.stderr.write(`grove watch error: ${msg}\n`);
      } else {
        process.stdout.write(`\ngrove: poll error — ${msg}\n`);
      }
    }

    firstRun = false;
    await new Promise(r => setTimeout(r, interval * 1000));
  }
}

async function main() {
  try {
    const { filter, allAuthors, authorArg, openReady, jsonOutput, watch, interval, noChecks, tableFormat, showHelp } =
      parseArgs(process.argv.slice(2));

    if (showHelp) {
      console.log(HELP);
      process.exit(0);
    }

    const repoRoot = getRepoRoot();
    const config = loadConfig(repoRoot);
    const checksEnabled = config.checks && !noChecks;
    const format: RenderFormat = tableFormat ? 'table' : config.format;

    const remoteUrl = getRemoteUrl();
    const { owner, repo } = parseOwnerRepo(remoteUrl);
    const trunk = getTrunk();

    if (watch) {
      process.once('SIGINT', () => { process.stdout.write('\n'); process.exit(130); });
      await runWatch({ owner, repo, trunk, allAuthors, authorArg, filter, checksEnabled }, jsonOutput, interval, format);
      return;
    }

    const branches = getLocalBranches();
    const currentBranch = getCurrentBranch();

    const spinner = startSpinner('Fetching PRs…');
    process.once('SIGINT', () => { spinner.stop(); process.exit(130); });

    const { roots, nodeMap, authorFilter } = await buildStack({
      owner, repo, trunk, branches, allAuthors, authorArg, filter, checksEnabled,
    });

    spinner.stop();

    if (openReady) {
      const url = findFirstReadyUrl(roots, nodeMap);
      if (url) {
        process.stdout.write(`Opening ${url}\n`);
        openUrl(url);
      } else {
        process.stdout.write('No PR is ready for review right now.\n');
      }
      return;
    }

    if (jsonOutput) {
      const out = buildJsonOutput(roots, nodeMap, trunk, `${owner}/${repo}`);
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      return;
    }

    render(roots, trunk, `${owner}/${repo}`, nodeMap, currentBranch, filter, authorFilter, format);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`grove: ${msg}\n`);
    process.exit(1);
  }
}

main();
