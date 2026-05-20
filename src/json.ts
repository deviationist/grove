import { TreeNode } from './tree';

export type Action =
  | 'merged'
  | 'needs_rebase'
  | 'fix_ci'
  | 'address_review'
  | 'request_review'
  | 'create_pr'
  | 'blocked';

export interface JsonBranch {
  branch: string;
  parent: string;
  pr: number | null;
  prTitle: string | null;
  prUrl: string | null;
  status: string;
  needsRebase: boolean;
  ci: 'passing' | 'failing' | 'pending' | null;
  reviews: 'approved' | 'changes_requested' | 'pending' | null;
  action: Action;
  /** Branch names in the stack that must merge before this one can */
  blockedBy: string[];
}

export interface JsonOutput {
  repo: string;
  trunk: string;
  generatedAt: string;
  summary: {
    total: number;
    merged: number;
    readyForReview: number;
    needsRebase: number;
    blocked: number;
    noPr: number;
  };
  /** Flat list sorted by descending priority — read top-to-bottom for what to do next */
  prioritized: JsonBranch[];
}

const ACTION_PRIORITY: Record<Action, number> = {
  needs_rebase: 0,
  fix_ci: 1,
  address_review: 2,
  request_review: 3,
  create_pr: 4,
  blocked: 5,
  merged: 6,
};

function unmergedAncestors(node: TreeNode, nodeMap: Map<string, TreeNode>): string[] {
  const blocked: string[] = [];
  let p = nodeMap.get(node.parent);
  while (p) {
    if (p.status !== 'merged') blocked.push(p.branch);
    p = nodeMap.get(p.parent);
  }
  return blocked;
}

function computeAction(node: TreeNode, blockedBy: string[]): Action {
  if (node.status === 'merged') return 'merged';
  if (node.needsRebase) return 'needs_rebase';
  if (blockedBy.length > 0) return 'blocked';
  if (!node.pr) return 'create_pr';
  if (node.ciStatus === 'failing') return 'fix_ci';
  if (node.reviewStatus === 'changes_requested') return 'address_review';
  return 'request_review';
}

function collectNodes(nodes: TreeNode[], out: TreeNode[]): void {
  for (const n of nodes) {
    out.push(n);
    collectNodes(n.children, out);
  }
}

export function buildJsonOutput(
  roots: TreeNode[],
  nodeMap: Map<string, TreeNode>,
  trunk: string,
  repo: string
): JsonOutput {
  const all: TreeNode[] = [];
  collectNodes(roots, all);

  const branches: JsonBranch[] = all.map(node => {
    const blockedBy = unmergedAncestors(node, nodeMap);
    const action = computeAction(node, blockedBy);
    return {
      branch: node.branch,
      parent: node.parent,
      pr: node.pr?.number ?? null,
      prTitle: node.pr?.title ?? null,
      prUrl: node.pr?.url ?? null,
      status: node.status,
      needsRebase: node.needsRebase,
      ci: node.ciStatus,
      reviews: node.reviewStatus,
      action,
      blockedBy,
    };
  });

  branches.sort((a, b) => ACTION_PRIORITY[a.action] - ACTION_PRIORITY[b.action]);

  const summary = {
    total: branches.length,
    merged: branches.filter(b => b.action === 'merged').length,
    readyForReview: branches.filter(b => b.action === 'request_review').length,
    needsRebase: branches.filter(b => b.action === 'needs_rebase').length,
    fixCi: branches.filter(b => b.action === 'fix_ci').length,
    addressReview: branches.filter(b => b.action === 'address_review').length,
    blocked: branches.filter(b => b.action === 'blocked').length,
    noPr: branches.filter(b => b.action === 'create_pr').length,
  };

  return {
    repo,
    trunk,
    generatedAt: new Date().toISOString(),
    summary,
    prioritized: branches,
  };
}
