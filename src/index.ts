import {
  getRepoRoot,
  getRemoteUrl,
  parseOwnerRepo,
  getTrunk,
  getLocalBranches,
  getCurrentBranch,
} from './git';
import { fetchPRs } from './github';
import { buildTree } from './tree';
import { render } from './render';

async function main() {
  try {
    getRepoRoot(); // throws if not inside a git repo

    const remoteUrl = getRemoteUrl();
    const { owner, repo } = parseOwnerRepo(remoteUrl);
    const trunk = getTrunk();
    const branches = getLocalBranches();
    const currentBranch = getCurrentBranch();

    const branchNames = branches.map(b => b.name).filter(n => n !== trunk);
    const prMap = await fetchPRs(owner, repo, branchNames);
    const { roots, nodeMap } = buildTree(branches, trunk, prMap);

    render(roots, trunk, `${owner}/${repo}`, nodeMap, currentBranch);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`grove: ${msg}\n`);
    process.exit(1);
  }
}

main();
