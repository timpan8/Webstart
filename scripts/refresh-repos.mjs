#!/usr/bin/env node
/* Skriver data/repos.json - en ögonblicksbild av ägarens PUBLIKA repon.
 *
 * Filen är inte sanningen om vad som visas; det är data/tools.json. Den här
 * används av hanteringssidan som reserv när GitHubs anropsgräns är slut, och
 * för att kunna upptäcka att ett repo bytt namn eller beskrivning.
 *
 *     node scripts/refresh-repos.mjs
 *
 * GITHUB_TOKEN är valfri men höjer anropsgränsen. Privata repon tas bort
 * oavsett token - den här filen publiceras. */

import { readFileSync, writeFileSync } from 'node:fs';

const OUT = 'data/repos.json';
const owner = process.env.GITHUB_REPOSITORY?.split('/')[0] || process.argv[2] || 'timpan8';
const token = process.env.GITHUB_TOKEN;

const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'webstart-refresh-repos',
};
if (token) headers.Authorization = `Bearer ${token}`;

const all = [];
for (let page = 1; page <= 10; page++) {
  const url = `https://api.github.com/users/${owner}/repos?per_page=100&type=owner&sort=pushed&page=${page}`;
  const response = await fetch(url, { headers });

  if (!response.ok) {
    console.error(`GitHub svarade ${response.status} för ${url}`);
    console.error(await response.text());
    process.exit(1);
  }

  const batch = await response.json();
  if (!Array.isArray(batch) || batch.length === 0) break;
  all.push(...batch);
  if (batch.length < 100) break;
}

const repos = all
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
  }))
  /* Stabil ordning, annars blir varje körning en diff. */
  .sort((a, b) => a.name.localeCompare(b.name, 'sv'));

const next = `${JSON.stringify({ owner, repos }, null, 2)}\n`;

let current = '';
try { current = readFileSync(OUT, 'utf8'); } catch { /* första körningen */ }

if (current === next) {
  console.log(`${OUT} är redan aktuell (${repos.length} publika repon).`);
} else {
  writeFileSync(OUT, next);
  console.log(`Skrev ${OUT}: ${repos.length} publika repon för ${owner}.`);
}
