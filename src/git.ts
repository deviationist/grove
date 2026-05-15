import { execFileSync, execFile } from 'child_process';

export interface Branch {
  name: string;
  tip: string;
  remote?: boolean; // true for branches that exist on GitHub but not checked out locally
}

export interface ParentInfo {
  parent: string;
  needsRebase: boolean;
}

function git(...args: string[]): string {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err: any) {
    const msg = err.stderr?.trim();
    throw new Error(msg || `git ${args.join(' ')} failed`);
  }
}

export function getRepoRoot(): string {
  return git('rev-parse', '--show-toplevel');
}

export function getRemoteUrl(): string {
  return git('remote', 'get-url', 'origin');
}

export function parseOwnerRepo(remoteUrl: string): { owner: string; repo: string } {
  const ssh = remoteUrl.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const https = remoteUrl.match(/https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (https) return { owner: https[1], repo: https[2] };
  throw new Error(`Cannot parse GitHub owner/repo from remote URL: ${remoteUrl}`);
}

export function getTrunk(): string {
  for (const name of ['main', 'master', 'develop']) {
    try {
      git('rev-parse', '--verify', name);
      return name;
    } catch { /* try next */ }
  }
  throw new Error('Could not find trunk branch (main, master, or develop)');
}

export function getCurrentBranch(): string {
  try {
    const name = git('rev-parse', '--abbrev-ref', 'HEAD');
    return name === 'HEAD' ? '' : name; // detached HEAD
  } catch {
    return '';
  }
}

export function getLocalBranches(): Branch[] {
  const out = git('for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads/');
  return out.split('\n').filter(Boolean).map(line => {
    const i = line.indexOf(' ');
    return { name: line.slice(0, i), tip: line.slice(i + 1) };
  });
}

export function getMergeBase(a: string, b: string): string | null {
  try {
    return git('merge-base', a, b);
  } catch {
    return null; // no common ancestor
  }
}

export function getMergeBaseAsync(a: string, b: string): Promise<string | null> {
  return new Promise(resolve => {
    execFile('git', ['merge-base', a, b], { encoding: 'utf8' }, (err, stdout) => {
      resolve(err ? null : stdout.trim());
    });
  });
}

export function countCommits(from: string, to: string): number {
  return parseInt(git('rev-list', '--count', `${from}..${to}`), 10);
}

/**
 * Find the closest parent branch for `branch` among `allBranches`.
 *
 * Scoring per candidate: (distance, !isDirectAncestor) — lower wins.
 * - distance = commits from mergeBase to branch.tip
 * - isDirectAncestor = mergeBase equals candidate.tip
 *
 * This correctly handles:
 *   - Sibling branches (same distance — prefer the direct ancestor)
 *   - Parent-has-moved / needsRebase (not a direct ancestor but closest distance wins)
 */
export function findParent(branch: Branch, allBranches: Branch[], trunk: string): ParentInfo {
  const trunkTip = allBranches.find(b => b.name === trunk)?.tip ?? git('rev-parse', trunk);
  const trunkMb = getMergeBase(branch.tip, trunkTip);

  if (!trunkMb) {
    // No common ancestor with trunk at all
    return { parent: trunk, needsRebase: false };
  }

  let bestName = trunk;
  let bestTip = trunkTip;
  let bestMb = trunkMb;
  let bestDist = countCommits(trunkMb, branch.tip);
  let bestIsAncestor = trunkMb === trunkTip;

  for (const candidate of allBranches) {
    if (candidate.name === branch.name || candidate.name === trunk) continue;

    const mb = getMergeBase(branch.tip, candidate.tip);
    if (!mb) continue;

    const dist = countCommits(mb, branch.tip);
    const isAncestor = mb === candidate.tip;

    // Score: (dist, !isAncestor) — lower is better (lex order)
    const better =
      dist < bestDist ||
      (dist === bestDist && isAncestor && !bestIsAncestor);

    if (better) {
      bestName = candidate.name;
      bestTip = candidate.tip;
      bestMb = mb;
      bestDist = dist;
      bestIsAncestor = isAncestor;
    }
  }

  return { parent: bestName, needsRebase: bestMb !== bestTip };
}
