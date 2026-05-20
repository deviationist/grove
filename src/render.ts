import chalk from 'chalk';
import { TreeNode } from './tree';

export type RenderFormat = 'default' | 'table';

interface Stats {
  ready: number;
  blocked: number;
  merged: number;
  rebase: number;
  fixCi: number;
  addressReview: number;
}

interface NodeLine {
  leftRaw: string;        // for width calculation
  leftColored: string;    // chalk-coloured version
  prRaw: string;          // "#12345" or ""
  pr: string;             // dim/linked version
  badgeRaw: string;       // plain text (chalk-stripped)
  badgeVisualWidth: number; // terminal columns (handles wide emoji)
  badge: string;          // chalk-coloured version
  noteRaw: string;        // plain text (all chars are narrow)
  note: string;           // chalk-coloured version
}

function hyperlink(text: string, url: string): string {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

function icon(node: TreeNode): { char: string; wide: boolean } {
  switch (node.status) {
    case 'merged': return { char: '✅', wide: true  };
    case 'open':   return { char: '●',  wide: false };
    case 'draft':  return { char: '◐',  wide: false };
    case 'no-pr':  return { char: '○',  wide: false };
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

function join(parts: string[], sep = '  '): string {
  return parts.filter(Boolean).join(sep);
}

// Returns [rawText, coloredText] — no leading whitespace so both tree and
// table modes can apply their own spacing.
function annotate(node: TreeNode, nodeMap: Map<string, TreeNode>, stats: Stats): [string, string] {
  if (node.status === 'merged') {
    stats.merged++;
    return ['', ''];
  }

  const rebaseRaw = node.needsRebase ? '⚠ needs rebase' : '';
  const rebase    = node.needsRebase ? chalk.yellow(rebaseRaw) : '';
  if (node.needsRebase) stats.rebase++;

  const ciRaw = node.ciStatus === 'failing' ? '✗ CI'
    : node.ciStatus === 'passing' ? '✓ CI' : '';
  const ci = node.ciStatus === 'failing' ? chalk.red(ciRaw)
    : node.ciStatus === 'passing' ? chalk.dim.green(ciRaw) : '';

  const rvRaw = node.reviewStatus === 'changes_requested' ? '↩ review'
    : node.reviewStatus === 'approved' ? '✓ approved' : '';
  const rv = node.reviewStatus === 'changes_requested' ? chalk.yellow(rvRaw)
    : node.reviewStatus === 'approved' ? chalk.dim.green(rvRaw) : '';

  if (ancestorsAllMerged(node, nodeMap)) {
    if (node.ciStatus === 'failing') {
      stats.fixCi++;
      return [
        join([ciRaw, rvRaw, '← fix CI', rebaseRaw]),
        join([ci, rv, chalk.bold.red('← fix CI'), rebase]),
      ];
    }
    if (node.reviewStatus === 'changes_requested') {
      stats.addressReview++;
      return [
        join([rvRaw, '← address review', rebaseRaw]),
        join([rv, chalk.bold.yellow('← address review'), rebase]),
      ];
    }
    stats.ready++;
    const label = node.status === 'no-pr' ? '← open PR' : '← request review';
    return [
      join([rvRaw, label, rebaseRaw]),
      join([rv, chalk.bold.white(label), rebase]),
    ];
  }

  stats.blocked++;
  return [
    join(['blocked', ciRaw, rvRaw, rebaseRaw]),
    join([chalk.dim('blocked'), ci, rv, rebase]),
  ];
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
    const connector   = isLast ? '└── ' : '├── ';
    const childPrefix = prefix + (isLast ? '    ' : '│   ');

    const isCurrent = node.branch === currentBranch;
    const rawName     = isCurrent ? `${node.branch} ◀` : node.branch;
    const coloredName = isCurrent
      ? chalk.bold(colorize(node, node.branch)) + chalk.dim(' ◀')
      : colorize(node, node.branch);

    const prRaw  = node.pr ? `#${node.pr.number}` : '';
    const prText = node.pr ? chalk.dim(`#${node.pr.number}`) : '';
    const pr     = node.pr?.url ? chalk.dim(hyperlink(`#${node.pr.number}`, node.pr.url)) : prText;

    // Badge: normalize icon to 2 visual columns so the status word always
    // starts at the same position regardless of whether the icon is wide (✅)
    // or narrow (●, ◐, ○).
    const { char: iconChar, wide } = icon(node);
    const iconPad     = wide ? '' : ' ';  // pad narrow icons to 2 visual cols
    const statusLabel = node.status === 'no-pr' ? 'local' : node.status;
    const remoteRaw   = node.remote ? '  · not local' : '';
    const badgeCoreRaw = `${iconChar}${iconPad} ${statusLabel}`;
    const badgeRaw     = badgeCoreRaw + remoteRaw;
    // Visual width: icon always 2 cols, pad 1 space, status word, optional remote
    const badgeVisualWidth = 2 + 1 + statusLabel.length + remoteRaw.length;
    const badge = colorize(node, badgeCoreRaw) + (node.remote ? chalk.dim(remoteRaw) : '');

    const [noteRaw, note] = annotate(node, nodeMap, stats);

    out.push({
      leftRaw:          prefix + connector + rawName,
      leftColored:      prefix + connector + coloredName,
      prRaw,
      pr,
      badgeRaw,
      badgeVisualWidth,
      badge,
      noteRaw,
      note,
    });

    collectLines(node.children, nodeMap, childPrefix, currentBranch, stats, out);
  }
}

function renderFooter(stats: Stats): void {
  const parts: string[] = [];
  if (stats.fixCi        > 0) parts.push(chalk.red(`${stats.fixCi} CI failing`));
  if (stats.addressReview > 0) parts.push(chalk.yellow(`${stats.addressReview} needs changes`));
  if (stats.ready        > 0) parts.push(chalk.bold.white(`${stats.ready} ready for review`));
  if (stats.rebase       > 0) parts.push(chalk.yellow(`${stats.rebase} needs rebase`));
  if (stats.blocked      > 0) parts.push(chalk.dim(`${stats.blocked} blocked`));
  if (stats.merged       > 0) parts.push(chalk.green(`${stats.merged} merged`));
  if (parts.length > 0) console.log(parts.join(chalk.dim('  ·  ')));
}

function renderDefault(
  lines: NodeLine[],
  trunk: string,
  ownerRepo: string,
  stats: Stats,
  filter?: string,
  author?: string
): void {
  const sep = chalk.dim('─'.repeat(54));
  const tags = [filter && `[${filter}]`, author && `@${author}`].filter(Boolean).join('  ');
  const header = chalk.bold(`grove  ·  ${ownerRepo}`) + (tags ? chalk.dim(`  ${tags}`) : '');

  console.log(header);
  console.log(sep);
  console.log(chalk.bold(trunk));

  if (lines.length === 0) {
    console.log(chalk.dim('  (no local branches)'));
  } else {
    const maxLeft  = Math.max(...lines.map(l => l.leftRaw.length));
    const maxPr    = Math.max(...lines.map(l => l.prRaw.length));
    const maxBadge = Math.max(...lines.map(l => l.badgeVisualWidth));

    const rendered = lines.map(l => {
      const namePad  = ' '.repeat(maxLeft - l.leftRaw.length + 2);
      const prCol    = l.pr
        ? l.pr + ' '.repeat(maxPr - l.prRaw.length + 2)
        : ' '.repeat(maxPr + 2);
      // Badge padding uses visual width, not string length, to handle wide emoji
      const badgePad = ' '.repeat(maxBadge - l.badgeVisualWidth + 2);
      const noteSep  = l.noteRaw ? '  ' : '';
      return `${l.leftColored}${namePad}${prCol}${l.badge}${badgePad}${noteSep}${l.note}`;
    });

    console.log(rendered.join('\n'));
  }

  console.log(sep);
  renderFooter(stats);
}

function renderTable(
  lines: NodeLine[],
  trunk: string,
  ownerRepo: string,
  stats: Stats,
  filter?: string,
  author?: string
): void {
  const H = '─', V = '│';
  const TL = '┌', TR = '┐', BL = '└', BR = '┘';
  const TM = '┬', BM = '┴', LM = '├', RM = '┤', X = '┼';

  // Column widths (minimum = header label length)
  const w0 = Math.max(...lines.map(l => l.leftRaw.length), trunk.length, 'BRANCH'.length);
  const w1 = Math.max(...lines.map(l => l.prRaw.length), 'PR'.length);
  const w2 = Math.max(...lines.map(l => l.badgeVisualWidth), 'STATUS'.length);
  const w3 = Math.max(...lines.map(l => l.noteRaw.length), 'ACTION'.length);

  // Each cell has 1 space padding on each side
  const cw = [w0 + 2, w1 + 2, w2 + 2, w3 + 2];

  const hline = (l: string, m: string, r: string) =>
    l + cw.map(w => H.repeat(w)).join(m) + r;

  const cell = (content: string, width: number) =>
    ' ' + content + ' '.repeat(width - content.length) + ' ';

  const tags = [filter && `[${filter}]`, author && `@${author}`].filter(Boolean).join('  ');
  const header = chalk.bold(`grove  ·  ${ownerRepo}`) + (tags ? chalk.dim(`  ${tags}`) : '');
  console.log(header);

  // Top border
  console.log(hline(TL, TM, TR));

  // Header row
  const headerRow = [
    chalk.dim(cell('BRANCH', w0)),
    chalk.dim(cell('PR', w1)),
    chalk.dim(cell('STATUS', w2)),
    chalk.dim(cell('ACTION', w3)),
  ].join(V);
  console.log(`${V}${headerRow}${V}`);

  // Header separator
  console.log(hline(LM, X, RM));

  // Trunk row
  const trunkRow = [
    ' ' + chalk.bold(trunk) + ' '.repeat(w0 - trunk.length + 1),
    ' '.repeat(cw[1]),
    ' '.repeat(cw[2]),
    ' '.repeat(cw[3]),
  ].join(V);
  console.log(`${V}${trunkRow}${V}`);

  // Data rows
  for (const l of lines) {
    const namePad  = ' '.repeat(w0 - l.leftRaw.length);
    const prPad    = ' '.repeat(w1 - l.prRaw.length);
    // Badge padding uses visual width to handle wide emoji
    const badgePad = ' '.repeat(w2 - l.badgeVisualWidth);
    const notePad  = ' '.repeat(w3 - l.noteRaw.length);

    const row = [
      ` ${l.leftColored}${namePad} `,
      ` ${l.pr}${prPad} `,
      ` ${l.badge}${badgePad} `,
      ` ${l.note}${notePad} `,
    ].join(V);
    console.log(`${V}${row}${V}`);
  }

  // Bottom border
  console.log(hline(BL, BM, BR));
  renderFooter(stats);
}

export function render(
  roots: TreeNode[],
  trunk: string,
  ownerRepo: string,
  nodeMap: Map<string, TreeNode>,
  currentBranch: string,
  filter?: string,
  author?: string,
  format: RenderFormat = 'default'
): void {
  const stats: Stats = { ready: 0, blocked: 0, merged: 0, rebase: 0, fixCi: 0, addressReview: 0 };
  const lines: NodeLine[] = [];

  if (roots.length > 0) {
    collectLines(roots, nodeMap, '', currentBranch, stats, lines);
  }

  if (format === 'table') {
    renderTable(lines, trunk, ownerRepo, stats, filter, author);
  } else {
    renderDefault(lines, trunk, ownerRepo, stats, filter, author);
  }
}
