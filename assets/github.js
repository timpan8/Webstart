/* GitHub-API-klient. Används bara av admin.html - startsidan rör aldrig API:et. */

const API = 'https://api.github.com';

/* Reserv när sidan körs lokalt. På github.io läses ägare och repo ur adressen,
   så att en omdöpning eller en fork fungerar utan kodändring. */
const FALLBACK_OWNER = 'timpan8';
const FALLBACK_REPO = 'Webstart';

export const BRANCH = 'main';
export const FILE_PATH = 'data/tools.json';

export const target = detectTarget();

function detectTarget() {
  const match = location.hostname.match(/^([\w-]+)\.github\.io$/i);
  if (!match) return { owner: FALLBACK_OWNER, repo: FALLBACK_REPO };

  const owner = match[1];
  const first = location.pathname.split('/').filter(Boolean)[0];
  /* Ett projektsegment saknar punkt; "admin.html" betyder att vi står på en användarsajt. */
  const repo = first && !first.includes('.') ? first : `${owner}.github.io`;
  return { owner, repo };
}

/* ---------- UTF-8-säker base64 ----------
   Ersätt INTE det här med ett rakt btoa(). btoa arbetar byte för byte och
   misslyckas på två olika sätt, varav det ena är tyst:

     btoa('Håller lösenord')  -> går igenom, men bytesen är inte giltig UTF-8.
                                 GitHub läser filen som UTF-8 och det blir
                                 "H\ufffdller l\ufffdsenord". Tyst datakorruption.
     btoa('—') / btoa('🔐')   -> kastar InvalidCharacterError.

   TextEncoder/TextDecoder ger riktig UTF-8 åt båda hållen. */

export function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000; // undvik "too many arguments" på stora filer
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function decodeBase64(base64) {
  const binary = atob(String(base64).replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/* ---------- Låg nivå ---------- */

export class GitHubError extends Error {
  constructor(message, { status, rateLimited = false } = {}) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.rateLimited = rateLimited;
  }
}

/** Senast sedda kvarvarande anrop, för att kunna visa det i gränssnittet. */
export const rateLimit = { remaining: null, limit: null, resetAt: null };

async function request(path, { token, method = 'GET', body } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new GitHubError('Kunde inte nå GitHub. Kontrollera nätverket.');
  }

  const remaining = response.headers.get('x-ratelimit-remaining');
  if (remaining !== null) {
    rateLimit.remaining = Number(remaining);
    rateLimit.limit = Number(response.headers.get('x-ratelimit-limit'));
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    rateLimit.resetAt = reset ? new Date(reset * 1000) : null;
  }

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => null);
  if (response.ok) return payload;

  /* 403 med noll kvar är kvoten, inte behörigheten - de kräver olika besked. */
  const isRateLimit = response.status === 403 && rateLimit.remaining === 0;
  const message = isRateLimit
    ? 'GitHubs anropsgräns är slut för din IP-adress.'
    : payload?.message || `GitHub svarade ${response.status}.`;

  throw new GitHubError(message, { status: response.status, rateLimited: isRateLimit });
}

/* ---------- Operationer ---------- */

/** Alla publika repon för ägaren. Privata utelämnas medvetet. */
export async function listRepos({ token } = {}) {
  const all = [];
  for (let page = 1; page <= 4; page++) {
    const batch = await request(
      `/users/${target.owner}/repos?per_page=100&type=owner&sort=pushed&page=${page}`,
      { token },
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }

  return all
    .filter((repo) => !repo.private)
    .map((repo) => ({
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description || '',
      homepage: repo.homepage || '',
      hasPages: Boolean(repo.has_pages),
      language: repo.language || '',
      topics: repo.topics || [],
      archived: Boolean(repo.archived),
      fork: Boolean(repo.fork),
      pushedAt: repo.pushed_at,
      htmlUrl: repo.html_url,
    }));
}

/** Läser tools.json från grenen. Returnerar sha, som krävs för att kunna skriva. */
export async function readToolsFile({ token } = {}) {
  const payload = await request(
    `/repos/${target.owner}/${target.repo}/contents/${FILE_PATH}?ref=${BRANCH}`,
    { token },
  );
  return { sha: payload.sha, text: decodeBase64(payload.content) };
}

/** Skriver tools.json. `sha` måste vara den senast lästa, annars nekar GitHub. */
export async function writeToolsFile({ token, text, sha, message }) {
  return request(`/repos/${target.owner}/${target.repo}/contents/${FILE_PATH}`, {
    token,
    method: 'PUT',
    body: {
      message,
      content: encodeBase64(text),
      sha,
      branch: BRANCH,
    },
  });
}

/** Kontrollerar att token duger till att skriva i just det här repot. */
export async function verifyToken(token) {
  const repo = await request(`/repos/${target.owner}/${target.repo}`, { token });
  if (!repo?.permissions?.push) {
    throw new GitHubError(`Token saknar skrivbehörighet till ${target.owner}/${target.repo}.`);
  }
  return repo;
}

/** Länken ett verktyg ska öppna, i den ordning plan och schema beskriver. */
export function resolveToolUrl(repo) {
  if (repo.homepage) return repo.homepage;
  if (repo.hasPages) return `https://${target.owner}.github.io/${repo.name}/`;
  return repo.htmlUrl;
}
