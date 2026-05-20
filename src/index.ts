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
import { fetchPRs, fetchCurrentUser } from './github';
import { buildTree, TreeNode } from './tree';
import { render } from './render';
import { buildJsonOutput } from './json';
import { startSpinner } from './spinner';

const HELP = `
grove — stacked PR visualizer

USAGE
  grove [filter] [options]

OPTIONS
  --all             Show PRs from all authors (default: yours only)
  --author <login>  Show PRs from a specific GitHub user
  --open            Open the first ready-for-review PR in your browser
  --json            Output machine-readable JSON (LLM-friendly)
  --help            Show this help message

FILTERING
  grove PLAT-12     Filter branches by name or PR title (case-insensitive)

EXAMPLES
  grove                      Your PRs in the current repo
  grove --all                Everyone's PRs
  grove --author alice       Alice's PRs only
  grove PLAT-12              Filter by keyword
  grove --open               Open the first PR ready for review
  grove --json               Machine-readable output for scripting/LLMs
`.trim();

function parseArgs(argv: string[]): {
  filter?: string;
  allAuthors: boolean;
  authorArg?: string;
  openReady: boolean;
  jsonOutput: boolean;
  showHelp: boolean;
} {
  let filter: string | undefined;
  let allAuthors = false;
  let authorArg: string | undefined;
  let openReady = false;
  let jsonOutput = false;
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
    } else if (argv[i] === '--author' && argv[i + 1]) {
      authorArg = argv[++i];
    } else if (!argv[i].startsWith('--')) {
      filter = argv[i];
    }
  }

  return { filter, allAuthors, authorArg, openReady, jsonOutput, showHelp };
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

async function main() {
  try {
    const { filter, allAuthors, authorArg, openReady, jsonOutput, showHelp } = parseArgs(process.argv.slice(2));

    if (showHelp) {
      console.log(HELP);
      process.exit(0);
    }

    getRepoRoot(); // throws if not inside a git repo

    const remoteUrl = getRemoteUrl();
    const { owner, repo } = parseOwnerRepo(remoteUrl);
    const trunk = getTrunk();
    const branches = getLocalBranches();
    const currentBranch = getCurrentBranch();

    const spinner = startSpinner('Fetching PRs…');

    // Clear the spinner cleanly on Ctrl+C
    process.once('SIGINT', () => {
      spinner.stop();
      process.exit(130);
    });

    const branchNames = branches.map(b => b.name).filter(n => n !== trunk);
    const [prMap, currentUser] = await Promise.all([
      fetchPRs(owner, repo, branchNames),
      allAuthors ? Promise.resolve(undefined) : fetchCurrentUser(),
    ]);

    spinner.update('Building tree…');

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
    const allBranches = remoteBranches.length > 0 ? [...branches, ...remoteBranches] : branches;

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

    render(roots, trunk, `${owner}/${repo}`, nodeMap, currentBranch, filter, authorFilter);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`grove: ${msg}\n`);
    process.exit(1);
  }
}

main();
