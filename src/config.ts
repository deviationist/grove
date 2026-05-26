import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface GroveConfig {
  /** Fetch CI and review state from GitHub. Default: true. */
  checks: boolean;
  /** Terminal output format. Default: "default". */
  format: 'default' | 'table';
  /** Hide local branches that have no associated PR. Default: false. */
  hideNoPr: boolean;
}

const DEFAULTS: GroveConfig = {
  checks: true,
  format: 'default',
  hideNoPr: false,
};

export function loadConfig(repoRoot: string): GroveConfig {
  const path = join(repoRoot, '.grove.json');
  if (!existsSync(path)) return DEFAULTS;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch {
    return DEFAULTS;
  }
}
