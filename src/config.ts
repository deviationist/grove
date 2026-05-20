import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface GroveConfig {
  /** Fetch CI and review state from GitHub. Default: true. */
  checks: boolean;
}

const DEFAULTS: GroveConfig = {
  checks: true,
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
