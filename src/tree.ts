import { Branch, findParent } from './git';
import { PRInfo } from './github';

export type BranchStatus = 'merged' | 'open' | 'draft' | 'no-pr';

export interface TreeNode {
  branch: string;
  parent: string;
  needsRebase: boolean;
  pr: PRInfo | null;
  children: TreeNode[];
  status: BranchStatus;
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

export function buildTree(
  branches: Branch[],
  trunk: string,
  prMap: Map<string, PRInfo>
): TreeResult {
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
    });
  }

  const nonTrunk = branches.filter(b => b.name !== trunk);
  for (const branch of nonTrunk) {
    const { parent, needsRebase } = findParent(branch, branches, trunk);
    const node = nodeMap.get(branch.name)!;
    node.parent = parent;
    node.needsRebase = needsRebase;
  }

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
  return { roots, nodeMap };
}
