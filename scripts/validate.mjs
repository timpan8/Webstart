#!/usr/bin/env node
/* Validerar data/tools.json. Körs i CI och går att köra för hand:
 *
 *     node scripts/validate.mjs
 *
 * Kontrollerar de invarianter startsidan faktiskt förlitar sig på. Schemat i
 * data/tools.schema.json finns för autocomplete i editorn; det här skriptet är
 * det som fäller ett trasigt bygge, och det har medvetet noll beroenden. */

import { readFileSync } from 'node:fs';

const FILE = 'data/tools.json';
const KNOWN_LOCKS = new Set(['name', 'description', 'icon', 'tags', 'category', 'url']);
const problems = [];

const fail = (where, text) => problems.push(`${where}: ${text}`);

let raw;
try {
  raw = readFileSync(FILE, 'utf8');
} catch (error) {
  console.error(`Kan inte läsa ${FILE}: ${error.message}`);
  process.exit(1);
}

let doc;
try {
  doc = JSON.parse(raw);
} catch (error) {
  console.error(`${FILE} är inte giltig JSON: ${error.message}`);
  process.exit(1);
}

if (doc.version !== 1) fail('version', `förväntade 1, hittade ${JSON.stringify(doc.version)}`);
if (!Array.isArray(doc.tools)) {
  console.error(`${FILE}: "tools" måste vara en lista.`);
  process.exit(1);
}

const seen = new Map();

doc.tools.forEach((tool, index) => {
  const where = `tools[${index}]${tool?.id ? ` (${tool.id})` : ''}`;

  if (typeof tool !== 'object' || tool === null) {
    fail(where, 'posten är inte ett objekt');
    return;
  }

  if (typeof tool.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(tool.id)) {
    fail(where, `"id" måste vara gemener, siffror och bindestreck — hittade ${JSON.stringify(tool.id)}`);
  } else if (seen.has(tool.id)) {
    fail(where, `"id" är redan använt av tools[${seen.get(tool.id)}]`);
  } else {
    seen.set(tool.id, index);
  }

  if (typeof tool.name !== 'string' || !tool.name.trim()) {
    fail(where, '"name" saknas eller är tomt');
  }

  /* Utan url och utan repo har kortet ingenstans att ta vägen. */
  if (!tool.url && !tool.repo) {
    fail(where, 'behöver antingen "url" eller "repo" — annars blir kortet en död länk');
  }
  if (tool.url !== undefined && !/^https?:\/\/\S+$/.test(tool.url)) {
    fail(where, `"url" måste börja med http:// eller https:// — hittade ${JSON.stringify(tool.url)}`);
  }
  if (tool.repo !== undefined && !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(tool.repo)) {
    fail(where, `"repo" ska skrivas ägare/namn — hittade ${JSON.stringify(tool.repo)}`);
  }

  for (const key of ['description', 'icon', 'category']) {
    if (tool[key] !== undefined && typeof tool[key] !== 'string') {
      fail(where, `"${key}" måste vara en sträng`);
    }
  }
  if (tool.hidden !== undefined && typeof tool.hidden !== 'boolean') {
    fail(where, '"hidden" måste vara true eller false');
  }
  if (tool.tags !== undefined
      && (!Array.isArray(tool.tags) || tool.tags.some((tag) => typeof tag !== 'string' || !tag.trim()))) {
    fail(where, '"tags" måste vara en lista med icke-tomma strängar');
  }
  if (tool.lock !== undefined) {
    if (!Array.isArray(tool.lock)) fail(where, '"lock" måste vara en lista');
    else {
      for (const field of tool.lock) {
        if (!KNOWN_LOCKS.has(field)) {
          fail(where, `"lock" nämner okänt fält ${JSON.stringify(field)} — giltiga: ${[...KNOWN_LOCKS].join(', ')}`);
        }
      }
    }
  }
});

const visible = doc.tools.filter((tool) => !tool?.hidden).length;

if (problems.length) {
  console.error(`${FILE} har ${problems.length} problem:\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`${FILE} är giltig: ${doc.tools.length} poster, ${visible} synliga, ${doc.tools.length - visible} dolda.`);
