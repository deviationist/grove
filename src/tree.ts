import { Branch, findParent, getMergeBaseAsync } from './git';
import { PRInfo, CIStatus, ReviewStatus } from './github';

export type BranchStatus = 'merged' | 'open' | 'draft' | 'no-pr';

export interface TreeNode {
  branch: string;
  parent: string;
  needsRebase: boolean;
  pr: PRInfo | null;
  children: TreeNode[];
  status: BranchStatus;
  remote: boolean;
  ciStatus: CIStatus | null;
  reviewStatus: ReviewStatus | null;
}

export interface TreeResult {
  roots: TreeNode[];
  nodeMap: Map<string, TreeNode>;
}

function statusFromPR(pr: PRInfo | null): BranchStatus {
  if (!pr) return 'no-pr';
  if (pr.merged) return 'merged';
  if (pr.draft) return 'draft';
  return 'open';
}

function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => a.branch.localeCompare(b.branch));
  for (const n of nodes) sortNodes(n.children);
}

// Remove merged nodes that have no open/draft descendants — they're done and
// add noise. A merged node is kept only if it still has active children after
// its own subtree is pruned (i.e. it's an ancestor in a live stack).
function pruneFullyMerged(nodes: TreeNode[], nodeMap: Map<string, TreeNode>): TreeNode[] {
  return nodes.filter(node => {
    node.children = pruneFullyMerged(node.children, nodeMap);
    if (node.status !== 'merged' || node.children.length > 0) return true;
    nodeMap.delete(node.branch);
    return false;
  });
}

export async function buildTree(
  branches: Branch[],
  trunk: string,
  prMap: Map<string, PRInfo>
): Promise<TreeResult> {
  const branchSet = new Set(branches.map(b => b.name));
  const tipByName = new Map(branches.map(b => [b.name, b.tip]));
  const nodeMap = new Map<string, TreeNode>();

  for (const branch of branches) {
    if (branch.name === trunk) continue;
    const pr = prMap.get(branch.name) ?? null;
    nodeMap.set(branch.name, {
      branch: branch.name,
      parent: trunk,
      needsRebase: false,
      pr,
      children: [],
      status: statusFromPR(pr),
      remote: !!branch.remote,
      ciStatus: null,
      reviewStatus: null,
    });
  }

  // Pass 1: determine parents (sync; findParent only for no-PR branches)
  const nonTrunk = branches.filter(b => b.name !== trunk);
  for (const branch of nonTrunk) {
    const node = nodeMap.get(branch.name)!;
    const pr = prMap.get(branch.name);

    let parentName: string;
    if (pr && pr.baseRef !== trunk && branchSet.has(pr.baseRef)) {
      parentName = pr.baseRef;
    } else if (pr) {
      parentName = trunk;
    } else {
      const { parent } = findParent(branch, branches, trunk);
      parentName = parent;
    }
    node.parent = parentName;
  }

  // Pass 2: needsRebase checks — run all git merge-base calls in parallel
  await Promise.all(
    nonTrunk
      .filter(b => !b.remote && b.tip)
      .map(async branch => {
        const node = nodeMap.get(branch.name)!;
        const parentTip = tipByName.get(node.parent);
        if (!parentTip) return;
        const mb = await getMergeBaseAsync(branch.tip, parentTip);
        node.needsRebase = mb !== parentTip;
      })
  );

  const roots: TreeNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parent === trunk) {
      roots.push(node);
    } else {
      const parentNode = nodeMap.get(node.parent);
      if (parentNode) {
        parentNode.children.push(node);
      } else {
        roots.push(node); // orphan — parent branch deleted locally
      }
    }
  }

  sortNodes(roots);
  const prunedRoots = pruneFullyMerged(roots, nodeMap);
  return { roots: prunedRoots, nodeMap };
}
