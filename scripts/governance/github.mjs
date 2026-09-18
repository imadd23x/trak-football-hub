const API = 'https://api.github.com';
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const SHA = /^[a-f0-9]{40}$/;

export function validateRepository(value) {
  if (typeof value !== 'string' || !REPOSITORY.test(value)) throw new Error('Repository must be OWNER/REPO');
  return value;
}

export function validateSha(value) {
  if (typeof value !== 'string' || !SHA.test(value)) throw new Error('Expected a full lowercase 40-character commit SHA');
  return value;
}

export function validateNumber(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('Expected a positive safe integer ID');
  return Number(value);
}

export function createGitHubClient({ token, fetchImpl = globalThis.fetch }) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('GITHUB_TOKEN is required for read-only GitHub checks');
  async function get(path) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\\x00-\x20]/.test(path) ||
        new URL(path, API).origin !== API || new URL(path, API).hash) {
      throw new Error('GitHub API path must be a relative absolute path on api.github.com');
    }
    let response;
    try {
      response = await fetchImpl(`${API}${path}`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      });
    } catch {
      throw new Error(`GitHub GET ${path} failed; check API access and retry`);
    }
    if (!response.ok) throw new Error(`GitHub GET ${path} returned HTTP ${response.status}; policy evidence is unavailable`);
    try { return await response.json(); } catch { throw new Error(`GitHub GET ${path} returned invalid JSON`); }
  }
  const prefix = repository => `/repos/${validateRepository(repository)}`;
  async function list(path) {
    const all = [];
    for (let page = 1; page <= 1000; page += 1) {
      const batch = await get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      if (!Array.isArray(batch) || batch.length > 100) throw new Error(`GitHub list ${path} returned an invalid page`);
      all.push(...batch);
      if (batch.length < 100) return all;
    }
    throw new Error(`GitHub list ${path} exceeded the pagination limit; refusing incomplete evidence`);
  }
  return {
    get,
    paginate: list,
    async getMain(repository) {
      const result = await get(`${prefix(repository)}/branches/main`);
      return validateSha(result?.commit?.sha);
    },
    getPullRequest: (repository, number) => get(`${prefix(repository)}/pulls/${validateNumber(number)}`),
    listOpenPullRequests: repository => list(`${prefix(repository)}/pulls?state=open`),
    listReviews: (repository, number) => list(`${prefix(repository)}/pulls/${validateNumber(number)}/reviews`),
    getActionsRun: (repository, id) => get(`${prefix(repository)}/actions/runs/${validateNumber(id)}`),
    async isAncestor(repository, ancestor, descendant) {
      validateSha(ancestor); validateSha(descendant);
      if (ancestor === descendant) return true;
      const result = await get(`${prefix(repository)}/compare/${ancestor}...${descendant}`);
      if (result?.base_commit?.sha !== ancestor || !['ahead', 'behind', 'identical', 'diverged'].includes(result?.status)) {
        throw new Error('GitHub compare returned incomplete or mismatched ancestry evidence');
      }
      return result.status === 'ahead' || result.status === 'identical';
    },
  };
}
