import chalk from 'chalk';
import { TreeNode } from './tree';

interface Stats {
  ready: number;
  blocked: number;
  merged: number;
  rebase: number;
}

function icon(node: TreeNode): string {
  if (node.needsRebase) return '⚠';
  switch (node.status) {
    case 'merged': return '✅';
    case 'open':   return '●';
    case 'draft':  return '◐';
    case 'no-pr':  return '○';
  }
}

function colorize(node: TreeNode, text: string): string {
  if (node.needsRebase) return chalk.yellow(text);
  switch (node.status) {
    case 'merged': return chalk.green(text);
    case 'open':   return chalk.blue(text);
    case 'draft':  return chalk.gray(text);
    case 'no-pr':  return chalk.dim(text);
  }
}

function ancestorsAllMerged(node: TreeNode, nodeMap: Map<string, TreeNode>): boolean {
  let p = node.parent;
  while (p) {
    const parent = nodeMap.get(p);
    if (!parent) break; // reached trunk
    if (parent.status !== 'merged') return false;
    p = parent.parent;
  }
  return true;
}

function annotate(node: TreeNode, nodeMap: Map<string, TreeNode>, stats: Stats): string {
  if (node.needsRebase) {
    stats.rebase++;
    return chalk.yellow('  ⚠ needs rebase');
  }
  if (node.status === 'merged') {
    stats.merged++;
    return '';
  }
  if (ancestorsAllMerged(node, nodeMap)) {
    stats.ready++;
    const label = node.status === 'no-pr' ? '← open PR' : '← request review';
    return chalk.bold.white(`  ${label}`);
  }
  stats.blocked++;
  return chalk.dim('  blocked');
}

function renderNode(
  node: TreeNode,
  nodeMap: Map<string, TreeNode>,
  prefix: string,
  isLast: boolean,
  currentBranch: string,
  stats: Stats
): string[] {
  const connector   = isLast ? '└── ' : '├── ';
  const childPrefix = prefix + (isLast ? '    ' : '│   ');

  const isCurrent = node.branch === currentBranch;
  const prNum     = node.pr ? chalk.dim(`  #${node.pr.number}`) : '';
  const name      = isCurrent
    ? chalk.bold(colorize(node, node.branch)) + chalk.dim(' ◀')
    : colorize(node, node.branch);
  const badge     = colorize(node, `${icon(node)} ${node.status === 'no-pr' ? 'local' : node.status}`);
  const note      = annotate(node, nodeMap, stats);

  const line = `${prefix}${connector}${name}${prNum}  ${badge}${note}`;

  const childLines = node.children.flatMap((child, i) =>
    renderNode(child, nodeMap, childPrefix, i === node.children.length - 1, currentBranch, stats)
  );

  return [line, ...childLines];
}

export function render(
  roots: TreeNode[],
  trunk: string,
  ownerRepo: string,
  nodeMap: Map<string, TreeNode>,
  currentBranch: string
): void {
  const sep = chalk.dim('─'.repeat(54));

  console.log(chalk.bold(`grove  ·  ${ownerRepo}`));
  console.log(sep);
  console.log(chalk.bold(trunk));

  const stats: Stats = { ready: 0, blocked: 0, merged: 0, rebase: 0 };

  if (roots.length === 0) {
    console.log(chalk.dim('  (no local branches)'));
  } else {
    const lines = roots.flatMap((root, i) =>
      renderNode(root, nodeMap, '', i === roots.length - 1, currentBranch, stats)
    );
    console.log(lines.join('\n'));
  }

  console.log(sep);

  const parts: string[] = [];
  if (stats.ready   > 0) parts.push(chalk.bold.white(`${stats.ready} ready for review`));
  if (stats.rebase  > 0) parts.push(chalk.yellow(`${stats.rebase} needs rebase`));
  if (stats.blocked > 0) parts.push(chalk.dim(`${stats.blocked} blocked`));
  if (stats.merged  > 0) parts.push(chalk.green(`${stats.merged} merged`));
  if (parts.length  > 0) console.log(parts.join(chalk.dim('  ·  ')));
}
