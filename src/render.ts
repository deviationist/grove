import chalk from 'chalk';
import { TreeNode } from './tree';

interface Stats {
  ready: number;
  blocked: number;
  merged: number;
  rebase: number;
  fixCi: number;
  addressReview: number;
}

interface NodeLine {
  leftRaw: string;     // prefix + connector + plain name (for width calculation)
  leftColored: string; // prefix + connector + chalked name
  prRaw: string;       // "#12345" or "" (for width calculation)
  pr: string;          // dim "#12345" or ""
  badge: string;
  note: string;
}

function hyperlink(text: string, url: string): string {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

function icon(node: TreeNode): string {
  switch (node.status) {
    case 'merged': return '✅';
    case 'open':   return '●';
    case 'draft':  return '◐';
    case 'no-pr':  return '○';
  }
}

function colorize(node: TreeNode, text: string): string {
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
    if (!parent) break;
    if (parent.status !== 'merged') return false;
    p = parent.parent;
  }
  return true;
}

function ciTag(node: TreeNode): string {
  if (node.ciStatus === 'failing') return chalk.red('  ✗ CI');
  if (node.ciStatus === 'passing') return chalk.dim.green('  ✓ CI');
  return '';
}

function reviewTag(node: TreeNode): string {
  if (node.reviewStatus === 'changes_requested') return chalk.yellow('  ↩ review');
  if (node.reviewStatus === 'approved')          return chalk.dim.green('  ✓ approved');
  return '';
}

function annotate(node: TreeNode, nodeMap: Map<string, TreeNode>, stats: Stats): string {
  if (node.status === 'merged') {
    stats.merged++;
    return '';
  }

  const rebase = node.needsRebase ? chalk.yellow('  ⚠ needs rebase') : '';
  if (node.needsRebase) stats.rebase++;

  if (ancestorsAllMerged(node, nodeMap)) {
    if (node.ciStatus === 'failing') {
      stats.fixCi++;
      return chalk.red('  ✗ CI') + reviewTag(node) + chalk.bold.red('  ← fix CI') + rebase;
    }
    if (node.reviewStatus === 'changes_requested') {
      stats.addressReview++;
      return chalk.yellow('  ↩ review') + chalk.bold.yellow('  ← address review') + rebase;
    }
    stats.ready++;
    const label = node.status === 'no-pr' ? '← open PR' : '← request review';
    const approved = node.reviewStatus === 'approved' ? chalk.dim.green('  ✓ approved') : '';
    return approved + chalk.bold.white(`  ${label}`) + rebase;
  }

  stats.blocked++;
  return chalk.dim('  blocked') + ciTag(node) + reviewTag(node) + rebase;
}

function collectLines(
  nodes: TreeNode[],
  nodeMap: Map<string, TreeNode>,
  prefix: string,
  currentBranch: string,
  stats: Stats,
  out: NodeLine[]
): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = prefix + (isLast ? '    ' : '│   ');

    const isCurrent = node.branch === currentBranch;
    const rawName = isCurrent ? `${node.branch} ◀` : node.branch;
    const coloredName = isCurrent
      ? chalk.bold(colorize(node, node.branch)) + chalk.dim(' ◀')
      : colorize(node, node.branch);

    const prRaw = node.pr ? `#${node.pr.number}` : '';
    const prText = node.pr ? chalk.dim(`#${node.pr.number}`) : '';
    const pr     = node.pr?.url ? chalk.dim(hyperlink(`#${node.pr.number}`, node.pr.url)) : prText;

    const statusLabel = node.status === 'no-pr' ? 'local' : node.status;
    const remoteMark  = node.remote ? chalk.dim('  · not local') : '';
    const badge = colorize(node, `${icon(node)} ${statusLabel}`) + remoteMark;
    const note  = annotate(node, nodeMap, stats);

    out.push({
      leftRaw:     prefix + connector + rawName,
      leftColored: prefix + connector + coloredName,
      prRaw,
      pr,
      badge,
      note,
    });

    collectLines(node.children, nodeMap, childPrefix, currentBranch, stats, out);
  }
}

export function render(
  roots: TreeNode[],
  trunk: string,
  ownerRepo: string,
  nodeMap: Map<string, TreeNode>,
  currentBranch: string,
  filter?: string,
  author?: string
): void {
  const sep = chalk.dim('─'.repeat(54));

  const tags = [filter && `[${filter}]`, author && `@${author}`]
    .filter(Boolean)
    .join('  ');
  const header = chalk.bold(`grove  ·  ${ownerRepo}`) + (tags ? chalk.dim(`  ${tags}`) : '');
  console.log(header);
  console.log(sep);
  console.log(chalk.bold(trunk));

  const stats: Stats = { ready: 0, blocked: 0, merged: 0, rebase: 0, fixCi: 0, addressReview: 0 };

  if (roots.length === 0) {
    console.log(chalk.dim('  (no local branches)'));
  } else {
    const lines: NodeLine[] = [];
    collectLines(roots, nodeMap, '', currentBranch, stats, lines);

    const maxLeft = Math.max(...lines.map(l => l.leftRaw.length));
    const maxPr   = Math.max(...lines.map(l => l.prRaw.length));

    const rendered = lines.map(l => {
      const namePad = ' '.repeat(maxLeft - l.leftRaw.length + 2);
      const prCol   = l.pr
        ? l.pr + ' '.repeat(maxPr - l.prRaw.length + 2)
        : ' '.repeat(maxPr + 2);
      return `${l.leftColored}${namePad}${prCol}${l.badge}${l.note}`;
    });

    console.log(rendered.join('\n'));
  }

  console.log(sep);

  const parts: string[] = [];
  if (stats.fixCi        > 0) parts.push(chalk.red(`${stats.fixCi} CI failing`));
  if (stats.addressReview > 0) parts.push(chalk.yellow(`${stats.addressReview} needs changes`));
  if (stats.ready        > 0) parts.push(chalk.bold.white(`${stats.ready} ready for review`));
  if (stats.rebase       > 0) parts.push(chalk.yellow(`${stats.rebase} needs rebase`));
  if (stats.blocked      > 0) parts.push(chalk.dim(`${stats.blocked} blocked`));
  if (stats.merged       > 0) parts.push(chalk.green(`${stats.merged} merged`));
  if (parts.length > 0) console.log(parts.join(chalk.dim('  ·  ')));
}
