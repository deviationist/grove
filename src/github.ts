import { execFileSync, execFile } from 'child_process';

export type CIStatus = 'passing' | 'failing' | 'pending';
export type ReviewStatus = 'approved' | 'changes_requested' | 'pending';

export interface ChecksResult {
  ci: CIStatus;
  reviews: ReviewStatus | null;
}

export interface PRInfo {
  number: number;
  title: string;
  state: 'open' | 'closed';
  merged: boolean;
  draft: boolean;
  url: string;
  headRef: string;
  baseRef: string;
  authorLogin: string;
}

function getToken(): string {
  try {
    return execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error('GitHub CLI not found or not authenticated. Run: gh auth login');
  }
}

function toPRInfo(pr: any): PRInfo {
  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    merged: !!pr.merged_at,
    draft: pr.draft,
    url: pr.html_url,
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    authorLogin: pr.user?.login ?? '',
  };
}

export function fetchCurrentUser(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'gh', ['api', 'user', '--jq', '.login'],
      { encoding: 'utf8' },
      (err, stdout) => {
        if (err) reject(new Error('Could not fetch GitHub user. Run: gh auth login'));
        else resolve(stdout.trim());
      }
    );
  });
}

async function ghFetch(url: string, headers: Record<string, string>): Promise<any[]> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
  return res.json() as Promise<any[]>;
}

export async function fetchPRs(
  owner: string,
  repo: string,
  branchNames: string[]
): Promise<Map<string, PRInfo>> {
  const token = getToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'grove-cli/0.1',
  };

  const map = new Map<string, PRInfo>();
  const base = `https://api.github.com/repos/${owner}/${repo}/pulls`;

  // Fetch all open/draft PRs — small result set even on huge repos
  for (let page = 1; page <= 5; page++) {
    const prs = await ghFetch(`${base}?state=open&per_page=100&page=${page}`, headers);
    for (const pr of prs) map.set(pr.head.ref, toPRInfo(pr));
    if (prs.length < 100) break;
  }

  // For local branches not found above, fetch their closed PR individually
  const missing = branchNames.filter(n => !map.has(n));
  await Promise.all(
    missing.map(async branch => {
      const prs = await ghFetch(
        `${base}?head=${owner}:${encodeURIComponent(branch)}&state=closed&per_page=1`,
        headers
      );
      if (prs.length > 0) map.set(branch, toPRInfo(prs[0]));
    })
  );

  return map;
}

function ciStatusFromRuns(runs: any[]): CIStatus {
  if (runs.length === 0) return 'pending';
  const badConclusions = new Set(['failure', 'cancelled', 'timed_out', 'action_required']);
  if (runs.some(r => r.status === 'completed' && badConclusions.has(r.conclusion))) return 'failing';
  if (runs.every(r => r.status === 'completed')) return 'passing';
  return 'pending';
}

function reviewStatusFromReviews(reviews: any[]): ReviewStatus {
  // Latest non-comment, non-dismissed review per reviewer
  const latest = new Map<string, string>();
  for (const r of reviews) {
    if (r.state !== 'COMMENTED' && r.state !== 'DISMISSED') {
      latest.set(r.user?.login ?? r.id, r.state);
    }
  }
  const states = [...latest.values()];
  if (states.includes('CHANGES_REQUESTED')) return 'changes_requested';
  if (states.length > 0 && states.every(s => s === 'APPROVED')) return 'approved';
  return 'pending';
}

export async function fetchChecks(
  owner: string,
  repo: string,
  nodes: Array<{ branch: string; prNumber: number | null }>
): Promise<Map<string, ChecksResult>> {
  const token = getToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'grove-cli/0.1',
  };

  const results = new Map<string, ChecksResult>();

  await Promise.all(
    nodes.map(async ({ branch, prNumber }) => {
      const [ciSettled, reviewSettled] = await Promise.allSettled([
        fetch(
          `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}/check-runs?per_page=100`,
          { headers }
        ).then(r => (r.ok ? r.json() : null)),
        prNumber != null
          ? fetch(
              `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=100`,
              { headers }
            ).then(r => (r.ok ? r.json() : null))
          : Promise.resolve(null),
      ]);

      const ciData = ciSettled.status === 'fulfilled' ? ciSettled.value : null;
      const reviewData = reviewSettled.status === 'fulfilled' ? reviewSettled.value : null;

      results.set(branch, {
        ci: ciData ? ciStatusFromRuns(ciData.check_runs ?? []) : 'pending',
        reviews: reviewData ? reviewStatusFromReviews(reviewData) : null,
      });
    })
  );

  return results;
}
