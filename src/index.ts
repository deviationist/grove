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
import { buildTree } from './tree';
import { render } from './render';
import { startSpinner } from './spinner';

function parseArgs(argv: string[]): { filter?: string; allAuthors: boolean; authorArg?: string } {
  let filter: string | undefined;
  let allAuthors = false;
  let authorArg: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--all') {
      allAuthors = true;
    } else if (argv[i] === '--author' && argv[i + 1]) {
      authorArg = argv[++i];
    } else if (!argv[i].startsWith('--')) {
      filter = argv[i];
    }
  }

  return { filter, allAuthors, authorArg };
}

async function main() {
  try {
    getRepoRoot(); // throws if not inside a git repo

    const { filter, allAuthors, authorArg } = parseArgs(process.argv.slice(2));

    const remoteUrl = getRemoteUrl();
    const { owner, repo } = parseOwnerRepo(remoteUrl);
    const trunk = getTrunk();
    const branches = getLocalBranches();
    const currentBranch = getCurrentBranch();

    const spinner = startSpinner('Fetching PRs…');

    const branchNames = branches.map(b => b.name).filter(n => n !== trunk);
    const [prMap, currentUser] = await Promise.all([
      fetchPRs(owner, repo, branchNames),
      allAuthors ? Promise.resolve(undefined) : fetchCurrentUser(),
    ]);

    spinner.update('Building tree…');

    const authorFilter = allAuthors ? undefined : (authorArg ?? currentUser);

    // Step 1: filter local branches by author + text
    const localNames = new Set(branches.map(b => b.name));
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

    // Step 2: find remote ancestors referenced by the filtered local branches only
    const filteredLocalNames = new Set(filteredLocal.map(b => b.name));
    const seen = new Set<string>();
    const remoteBranches: Branch[] = [];
    for (const b of filteredLocal) {
      if (b.name === trunk) continue;
      const pr = prMap.get(b.name);
      if (!pr) continue;
      const ref = pr.baseRef;
      if (ref !== trunk && !filteredLocalNames.has(ref) && !seen.has(ref) && prMap.has(ref)) {
        seen.add(ref);
        remoteBranches.push({ name: ref, tip: '', remote: true });
      }
    }

    const filteredBranches = [...filteredLocal, ...remoteBranches];

    const { roots, nodeMap } = await buildTree(filteredBranches, trunk, prMap);

    spinner.stop();

    render(roots, trunk, `${owner}/${repo}`, nodeMap, currentBranch, filter, authorFilter);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`grove: ${msg}\n`);
    process.exit(1);
  }
}

main();
