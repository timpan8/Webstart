/* Hanteringssidan. Redigerar data/tools.json och sparar antingen direkt till
   GitHub via Contents-API:t eller genom att du exporterar filen. */

import { $, el, fold, slugify } from './dom.js';
import {
  target, BRANCH, FILE_PATH,
  listRepos, readToolsFile, writeToolsFile, verifyToken,
  resolveToolUrl, rateLimit,
} from './github.js';

const DATA_URL = 'data/tools.json';
const REPOS_FALLBACK = 'data/repos.json';
const TOKEN_KEY = 'webstart:token';
const TOKEN_WHERE_KEY = 'webstart:token-where';
const CACHE_KEY = 'webstart:repo-cache';
const CACHE_TTL = 10 * 60 * 1000;

/* Fältordningen i den sparade filen. Håller diffar läsbara över tid. */
const FIELD_ORDER = ['id', 'name', 'description', 'repo', 'url', 'icon', 'tags', 'category', 'hidden', 'lock'];

const ICONS = {
  chevron: '<svg viewBox="0 0 16 16" width="13" height="13"><path fill="currentColor" d="M4.3 6.3a1 1 0 0 1 1.4 0L8 8.6l2.3-2.3a1 1 0 1 1 1.4 1.4l-3 3a1 1 0 0 1-1.4 0l-3-3a1 1 0 0 1 0-1.4"/></svg>',
  eye: '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M8 3c3.1 0 5.7 1.9 7 5-1.3 3.1-3.9 5-7 5s-5.7-1.9-7-5c1.3-3.1 3.9-5 7-5m0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6m0 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3"/></svg>',
  eyeOff: '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M2.7 1.3a1 1 0 0 0-1.4 1.4l2 2C2.1 5.6 1.4 6.7 1 8c1.3 3.1 3.9 5 7 5 1.2 0 2.4-.3 3.4-.9l1.9 1.9a1 1 0 0 0 1.4-1.4zM8 11a3 3 0 0 1-2.8-4.1l1.2 1.2a1.5 1.5 0 0 0 1.7 1.7l1.2 1.2A3 3 0 0 1 8 11m6.9-3c-.6-1.4-1.5-2.6-2.7-3.4l-1.4 1.4A5.6 5.6 0 0 1 12.8 8c-.2.5-.5.9-.8 1.3l1.4 1.4c.6-.8 1.1-1.7 1.5-2.7M8 5c-.3 0-.6 0-.9.1L5.5 3.5C6.3 3.2 7.1 3 8 3c3.1 0 5.7 1.9 7 5"/></svg>',
  trash: '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M6.5 1a1 1 0 0 0-1 1v.5H3a1 1 0 0 0 0 2h10a1 1 0 1 0 0-2h-2.5V2a1 1 0 0 0-1-1zM4 6h8l-.6 7.1a1 1 0 0 1-1 .9H5.6a1 1 0 0 1-1-.9z"/></svg>',
  check: '<svg viewBox="0 0 16 16" width="11" height="11"><path fill="currentColor" d="M13.5 3.5a1 1 0 0 1 0 1.4l-6.5 6.5a1 1 0 0 1-1.4 0l-3-3a1 1 0 0 1 1.4-1.4L6.3 9.3l5.8-5.8a1 1 0 0 1 1.4 0"/></svg>',
};

/* ---------- Tillstånd ---------- */

const state = {
  doc: { $schema: './tools.schema.json', version: 1, title: 'Verktyg', tools: [] },
  tools: [],
  repos: [],
  baseline: '',
  token: '',
  tokenWhere: 'session',
  open: new Set(),
  focusHandle: null,
  repoQuery: '',
  loaded: false,
  saving: false,
};

/* ---------- Serialisering ---------- */

function cleanTool(tool) {
  const out = {};
  for (const key of FIELD_ORDER) {
    let value = tool[key];
    if (value == null) continue;
    if (typeof value === 'string') {
      value = value.trim();
      if (!value) continue;
    }
    if (Array.isArray(value)) {
      value = value.map((entry) => String(entry).trim()).filter(Boolean);
      if (!value.length) continue;
    }
    if (value === false) continue;
    out[key] = value;
  }
  /* Behåll fält som admin inte känner till, så att en AI kan införa egna
     utan att nästa sparning i gränssnittet raderar dem. */
  for (const [key, value] of Object.entries(tool)) {
    if (!FIELD_ORDER.includes(key)) out[key] = value;
  }
  return out;
}

const serialize = () =>
  `${JSON.stringify({ ...state.doc, tools: state.tools.map(cleanTool) }, null, 2)}\n`;

const isDirty = () => state.loaded && serialize() !== state.baseline;

/* ---------- Små hjälpare ---------- */

function toast(text, kind = '') {
  const node = el('div', { class: `toast${kind ? ` toast-${kind}` : ''}`, text });
  $('#toasts').append(node);
  setTimeout(() => node.remove(), 4500);
}

function message(text, kind = 'warn') {
  $('#messages').append(el('div', { class: `notice notice-${kind}`, text }));
}

const clearMessages = () => $('#messages').replaceChildren();

function refreshStatus() {
  const dirty = isDirty();
  document.body.classList.toggle('is-dirty', dirty);
  $('#btn-save').disabled = !state.token || !dirty || state.saving;
  $('#save-state').textContent = state.saving
    ? 'Sparar…'
    : dirty ? 'Osparade ändringar'
    : state.loaded ? 'Allt sparat' : '';

  if (rateLimit.remaining !== null) {
    $('#rate-info').textContent = `${rateLimit.remaining} API-anrop kvar`;
  }
}

/* ---------- Token ---------- */

function readStoredToken() {
  try {
    const where = localStorage.getItem(TOKEN_WHERE_KEY) === 'local' ? 'local' : 'session';
    const store = where === 'local' ? localStorage : sessionStorage;
    return { token: store.getItem(TOKEN_KEY) || '', where };
  } catch {
    return { token: '', where: 'session' };
  }
}

function persistToken(token, where) {
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    if (!token) {
      localStorage.removeItem(TOKEN_WHERE_KEY);
      return;
    }
    localStorage.setItem(TOKEN_WHERE_KEY, where);
    (where === 'local' ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
  } catch {
    toast('Webbläsaren tillåter inte lagring — token gäller bara den här sidvisningen.', 'danger');
  }
}

function setTokenBadge(text, kind = '') {
  const badge = $('#token-badge');
  badge.textContent = text;
  badge.className = `pill${kind ? ` pill-${kind}` : ''}`;
}

async function useToken(token, where, { quiet = false } = {}) {
  state.token = token;
  state.tokenWhere = where;
  if (!token) {
    setTokenBadge('ingen token');
    refreshStatus();
    return;
  }
  setTokenBadge('kontrollerar…');
  try {
    await verifyToken(token);
    persistToken(token, where);
    setTokenBadge(`kan spara till ${target.repo}`, 'ok');
    if (!quiet) toast('Token fungerar.', 'ok');
  } catch (error) {
    state.token = '';
    setTokenBadge('token duger inte', 'warn');
    if (!quiet) toast(error.message, 'danger');
    else message(`Den sparade token fungerar inte längre: ${error.message}`);
  }
  refreshStatus();
}

/* ---------- Inläsning ---------- */

async function loadTools() {
  const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${DATA_URL} svarade ${response.status}`);
  const text = await response.text();
  applyDocument(text);
  state.baseline = serialize();
  state.loaded = true;
}

function applyDocument(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed?.tools)) throw new Error('tools.json saknar en "tools"-lista');
  const { tools, ...rest } = parsed;
  state.doc = { ...rest, tools: [] };
  state.tools = tools.map((tool) => ({ ...tool, tags: tool.tags ? [...tool.tags] : [] }));
}

function readRepoCache() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    if (raw && Date.now() - raw.at < CACHE_TTL) return raw.repos;
  } catch { /* trasig cache är inte värd att rädda */ }
  return null;
}

async function loadRepos() {
  const cached = readRepoCache();
  if (cached) {
    state.repos = cached;
    renderRepos();
  }

  try {
    state.repos = await listRepos({ token: state.token || undefined });
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), repos: state.repos }));
    } catch { /* full eller blockerad lagring */ }
  } catch (error) {
    if (cached) {
      message('Kunde inte uppdatera repolistan från GitHub — visar den senast hämtade.');
    } else if (await loadReposFallback()) {
      message(error.rateLimited
        ? 'GitHubs anropsgräns är slut för din IP-adress. Visar den dagliga ögonblicksbilden i stället.'
        : `Kunde inte nå GitHub (${error.message}) — visar den dagliga ögonblicksbilden i stället.`);
    } else {
      message(`Kunde inte hämta dina repon: ${error.message}`, 'danger');
    }
  }
  renderRepos();
  refreshStatus();
}

/** Reserven som refresh-repos-workflowen skriver. Saknas den är det inte ett fel. */
async function loadReposFallback() {
  try {
    const response = await fetch(REPOS_FALLBACK, { cache: 'no-store' });
    if (!response.ok) return false;
    const data = await response.json();
    if (!Array.isArray(data?.repos)) return false;
    state.repos = data.repos;
    return true;
  } catch {
    return false;
  }
}

/* ---------- Upptäcktslistan ---------- */

function repoBadges(repo) {
  const badges = [];
  if (repo.hasPages) badges.push(el('span', { class: 'pill pill-ok', text: 'Pages' }));
  else badges.push(el('span', { class: 'pill', text: 'ingen Pages' }));
  if (repo.archived) badges.push(el('span', { class: 'pill pill-warn', text: 'arkiverat' }));
  if (repo.fork) badges.push(el('span', { class: 'pill', text: 'fork' }));
  if (repo.language) badges.push(el('span', { class: 'pill', text: repo.language }));
  return badges;
}

function renderRepos() {
  const list = $('#repo-list');
  const chosen = new Set(state.tools.map((tool) => (tool.repo || '').toLowerCase()));
  const terms = fold(state.repoQuery).split(/\s+/).filter(Boolean);

  const shown = state.repos.filter((repo) => {
    const hay = fold(`${repo.name} ${repo.description} ${repo.language} ${repo.topics.join(' ')}`);
    return terms.every((term) => hay.includes(term));
  });

  $('#repo-count').textContent = state.repos.length
    ? `${shown.length}${shown.length === state.repos.length ? '' : ` av ${state.repos.length}`}`
    : '';

  list.replaceChildren();

  if (!state.repos.length) {
    list.append(el('div', { class: 'empty-small', text: 'Hämtar dina repon…' }));
    return;
  }
  if (!shown.length) {
    list.append(el('div', { class: 'empty-small', text: 'Inget repo matchar filtret.' }));
    return;
  }

  for (const repo of shown) {
    const picked = chosen.has(repo.fullName.toLowerCase());
    list.append(el('button', {
      class: 'repo-row',
      type: 'button',
      'aria-pressed': String(picked),
      onclick: () => (picked ? removeByRepo(repo.fullName) : addRepo(repo)),
    },
      el('span', { class: 'repo-check', html: ICONS.check }),
      el('span', { class: 'repo-main' },
        el('span', { class: 'repo-name' }, repo.name, ...repoBadges(repo)),
        repo.description
          ? el('span', { class: 'repo-desc', text: repo.description })
          : null),
    ));
  }
}

function addRepo(repo) {
  const taken = new Set(state.tools.map((tool) => tool.id));
  const base = slugify(repo.name);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;

  const tool = {
    id,
    name: repo.name,
    description: repo.description || '',
    repo: repo.fullName,
    icon: '',
    tags: repo.topics.slice(0, 3),
    category: '',
  };

  /* Skriv bara ut url när den pekar någon annanstans än på själva repot -
     annars klarar startsidans fallback det, och posten läker av sig själv
     om Pages slås på senare. */
  const url = resolveToolUrl(repo);
  if (url && url !== repo.htmlUrl) tool.url = url;

  state.tools.push(tool);
  state.open.add(id);
  render();
  toast(`${repo.name} tillagt.`);
}

function removeByRepo(fullName) {
  const key = fullName.toLowerCase();
  state.tools = state.tools.filter((tool) => (tool.repo || '').toLowerCase() !== key);
  render();
  toast(`${fullName.split('/')[1]} borttaget.`);
}

/* ---------- Din lista ---------- */

function iconNode(tool) {
  if (tool.icon?.trim()) {
    return el('span', { class: 'tool-icon', 'aria-hidden': 'true', text: tool.icon.trim() });
  }
  return el('span', { class: 'tool-icon', 'aria-hidden': 'true' },
    el('span', { class: 'tool-icon-letter', text: (tool.name || '?').trim().charAt(0).toUpperCase() }));
}

function formRow({ label, span, control, note }) {
  return el('div', { class: `form-row${span ? ' span-2' : ''}` },
    el('label', { text: label }), control,
    note ? el('span', { class: 'form-note', text: note }) : null);
}

function textInput(value, placeholder, onInput) {
  return el('input', { class: 'field', type: 'text', value: value || '', placeholder, oninput: onInput });
}

function toolItem(tool, index) {
  const item = el('li', {
    class: `tool-item${tool.hidden ? ' is-hidden' : ''}${state.open.has(tool.id) ? ' is-open' : ''}`,
    'data-id': tool.id,
  });

  /* --- rubrikraden --- */

  const handle = el('button', {
    class: 'drag-handle', type: 'button', title: 'Dra för att flytta',
    'aria-label': `Flytta ${tool.name}`, text: '⠿',
    onmousedown: () => { item.draggable = true; },
    onmouseup: () => { item.draggable = false; },
    onkeydown: (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      moveBy(index, event.key === 'ArrowUp' ? -1 : 1);
    },
  });

  const titleText = el('span', { class: 'tool-title-text', text: tool.name || tool.id });
  const subText = el('span', { class: 'tool-sub', text: subtitleFor(tool) });

  const toggleOpen = el('button', {
    class: 'btn btn-icon', type: 'button', html: ICONS.chevron,
    title: 'Visa eller dölj fälten', 'aria-expanded': String(state.open.has(tool.id)),
    onclick: () => {
      const open = state.open.has(tool.id);
      if (open) state.open.delete(tool.id); else state.open.add(tool.id);
      item.classList.toggle('is-open', !open);
      toggleOpen.setAttribute('aria-expanded', String(!open));
    },
  });

  const hideToggle = el('button', {
    class: `btn btn-icon${tool.hidden ? ' is-on' : ''}`, type: 'button',
    html: tool.hidden ? ICONS.eyeOff : ICONS.eye,
    title: tool.hidden ? 'Dold — klicka för att visa' : 'Visas — klicka för att dölja',
    onclick: () => { tool.hidden = !tool.hidden; render(); },
  });

  const remove = el('button', {
    class: 'btn btn-icon is-danger', type: 'button', html: ICONS.trash,
    title: 'Ta bort ur listan',
    onclick: () => {
      state.tools = state.tools.filter((entry) => entry !== tool);
      render();
      toast(`${tool.name} borttaget. Spara inte om du ångrar dig.`);
    },
  });

  item.append(el('div', { class: 'tool-row' },
    handle, iconNode(tool),
    el('div', { class: 'tool-titles' },
      el('div', { class: 'tool-title' }, titleText,
        tool.hidden ? el('span', { class: 'pill', text: 'dold' }) : null,
        tool.lock?.length ? el('span', { class: 'pill', text: 'låst' }) : null),
      subText),
    el('div', { class: 'tool-actions' }, hideToggle, toggleOpen, remove)));

  /* --- utfällt formulär --- */

  const touch = () => { subText.textContent = subtitleFor(tool); refreshStatus(); };

  const grid = el('div', { class: 'form-grid' },
    formRow({
      label: 'Namn',
      control: textInput(tool.name, 'Namn på kortet', (event) => {
        tool.name = event.target.value;
        titleText.textContent = tool.name || tool.id;
        touch();
      }),
      note: `id: ${tool.id}`,
    }),
    formRow({
      label: 'Ikon',
      control: textInput(tool.icon, 'En emoji, t.ex. 🔐', (event) => {
        tool.icon = event.target.value;
        refreshStatus();
      }),
      note: 'Lämnas den tom används första bokstaven i namnet.',
    }),
    formRow({
      label: 'Länk som öppnas',
      span: true,
      control: textInput(tool.url, tool.repo ? `Tomt = ${`https://github.com/${tool.repo}`}` : 'https://…',
        (event) => { tool.url = event.target.value; touch(); }),
      note: 'Tomt fält faller tillbaka på repots GitHub-sida.',
    }),
    formRow({
      label: 'Repo',
      control: textInput(tool.repo, 'ägare/namn', (event) => {
        tool.repo = event.target.value;
        touch();
        renderRepos();
      }),
      note: 'Ger källkodslänken på kortet.',
    }),
    formRow({
      label: 'Kategori',
      control: textInput(tool.category, 'Tomt = ingen gruppering', (event) => {
        tool.category = event.target.value;
        refreshStatus();
      }),
      note: 'Har någon post en kategori grupperas startsidan i sektioner.',
    }),
    formRow({
      label: 'Taggar',
      span: true,
      control: textInput((tool.tags || []).join(', '), 'kommaseparerat', (event) => {
        tool.tags = event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean);
        refreshStatus();
      }),
    }),
    formRow({
      label: 'Beskrivning',
      span: true,
      control: el('textarea', {
        class: 'field', rows: '3', placeholder: 'Vad gör verktyget?',
        oninput: (event) => { tool.description = event.target.value; touch(); },
      }, tool.description || ''),
      note: 'Ungefär 120 tecken visas på kortet innan texten klipps.',
    }),
  );

  const lockBox = el('input', {
    type: 'checkbox', id: `lock-${tool.id}`,
    onchange: (event) => {
      tool.lock = event.target.checked ? ['description'] : [];
      render();
    },
  });
  if (tool.lock?.includes('description')) lockBox.checked = true;

  item.append(el('div', { class: 'tool-edit' }, grid,
    el('div', { class: 'lock-row' }, lockBox,
      el('label', { for: `lock-${tool.id}`, text: 'Lås beskrivningen så att en AI inte skriver om den' }))));

  return item;
}

function subtitleFor(tool) {
  const link = (tool.url || (tool.repo ? `https://github.com/${tool.repo}` : '')).replace(/^https?:\/\//, '');
  const text = tool.description?.trim();
  return text ? `${text.slice(0, 70)}${text.length > 70 ? '…' : ''}` : link || 'ingen länk';
}

function renderTools() {
  const list = $('#tool-list');
  const hiddenCount = state.tools.filter((tool) => tool.hidden).length;
  $('#tool-count').textContent = state.tools.length
    ? `${state.tools.length - hiddenCount} synliga${hiddenCount ? `, ${hiddenCount} dolda` : ''}`
    : '';

  list.replaceChildren();
  if (!state.tools.length) {
    list.append(el('div', { class: 'empty-small', text: 'Listan är tom. Bocka i ett repo till vänster.' }));
    return;
  }
  state.tools.forEach((tool, index) => list.append(toolItem(tool, index)));

  if (state.focusHandle) {
    const item = list.querySelector(`.tool-item[data-id="${CSS.escape(state.focusHandle)}"]`);
    item?.querySelector('.drag-handle')?.focus();
    state.focusHandle = null;
  }
}

const render = () => { renderTools(); renderRepos(); refreshStatus(); };

/* ---------- Omordning ---------- */

function moveBy(index, delta) {
  const next = index + delta;
  if (next < 0 || next >= state.tools.length) return;
  const [tool] = state.tools.splice(index, 1);
  state.tools.splice(next, 0, tool);
  state.focusHandle = tool.id;
  render();
}

function moveOnto(dragId, targetId, after) {
  const from = state.tools.findIndex((tool) => tool.id === dragId);
  if (from === -1) return;
  const [tool] = state.tools.splice(from, 1);
  let to = state.tools.findIndex((entry) => entry.id === targetId);
  if (to === -1) to = state.tools.length;
  else if (after) to += 1;
  state.tools.splice(to, 0, tool);
  render();
}

const clearDropMarks = () =>
  document.querySelectorAll('.drop-before, .drop-after')
    .forEach((node) => node.classList.remove('drop-before', 'drop-after'));

function initDragAndDrop() {
  const list = $('#tool-list');
  let dragId = null;

  list.addEventListener('dragstart', (event) => {
    const item = event.target.closest('.tool-item');
    if (!item) return;
    dragId = item.dataset.id;
    item.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragId);
  });

  list.addEventListener('dragover', (event) => {
    if (!dragId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const over = event.target.closest('.tool-item');
    clearDropMarks();
    if (!over || over.dataset.id === dragId) return;
    const box = over.getBoundingClientRect();
    over.classList.add(event.clientY > box.top + box.height / 2 ? 'drop-after' : 'drop-before');
  });

  list.addEventListener('drop', (event) => {
    if (!dragId) return;
    event.preventDefault();
    const over = event.target.closest('.tool-item');
    clearDropMarks();
    if (over && over.dataset.id !== dragId) {
      const box = over.getBoundingClientRect();
      moveOnto(dragId, over.dataset.id, event.clientY > box.top + box.height / 2);
    }
    dragId = null;
  });

  list.addEventListener('dragend', () => {
    clearDropMarks();
    document.querySelectorAll('.is-dragging').forEach((node) => node.classList.remove('is-dragging'));
    dragId = null;
  });
}

/* ---------- Spara ---------- */

function askConflict() {
  return new Promise((resolve) => {
    const dialog = $('#conflict-dialog');
    const finish = (value) => { dialog.close(); resolve(value); };
    $('#conflict-reload').onclick = () => finish('reload');
    $('#conflict-force').onclick = () => finish('force');
    dialog.addEventListener('cancel', () => resolve('cancel'), { once: true });
    dialog.showModal();
  });
}

async function save() {
  if (!state.token || state.saving) return;
  state.saving = true;
  refreshStatus();
  clearMessages();

  try {
    /* Hämta alltid färsk sha precis före skrivningen. Skiljer sig innehållet
       från det vi läste in har någon annan hunnit emellan. */
    const remote = await readToolsFile({ token: state.token });

    if (remote.text !== state.baseline) {
      const choice = await askConflict();
      if (choice === 'cancel') return;
      if (choice === 'reload') {
        applyDocument(remote.text);
        state.baseline = serialize();
        state.open.clear();
        render();
        toast('Läste om versionen från GitHub.');
        return;
      }
    }

    const text = serialize();
    const visible = state.tools.filter((tool) => !tool.hidden).length;
    await writeToolsFile({
      token: state.token,
      text,
      sha: remote.sha,
      message: `Uppdatera verktygslistan (${visible} synliga, ${state.tools.length} totalt)`,
    });

    state.baseline = text;
    toast('Sparat. Sidan bygger om på ungefär en minut.', 'ok');
  } catch (error) {
    message(`Kunde inte spara: ${error.message}`, 'danger');
    toast('Sparningen misslyckades.', 'danger');
  } finally {
    state.saving = false;
    refreshStatus();
  }
}

/* ---------- Export ---------- */

function download() {
  const blob = new Blob([serialize()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: 'tools.json' });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast(`Nedladdad. Lägg filen i ${FILE_PATH} och committa.`);
}

async function copy() {
  try {
    await navigator.clipboard.writeText(serialize());
    toast('JSON kopierad till urklipp.', 'ok');
  } catch {
    toast('Webbläsaren tillät inte kopiering. Använd Ladda ner i stället.', 'danger');
  }
}

/* ---------- Start ---------- */

function initControls() {
  $('#btn-save').addEventListener('click', save);
  $('#btn-download').addEventListener('click', download);
  $('#btn-copy').addEventListener('click', copy);

  $('#btn-reload').addEventListener('click', async () => {
    if (isDirty() && !confirm('Du har osparade ändringar. Läsa om ändå?')) return;
    clearMessages();
    state.open.clear();
    await loadTools();
    render();
    toast('Omläst.');
  });

  $('#btn-add-link').addEventListener('click', () => {
    const taken = new Set(state.tools.map((tool) => tool.id));
    let id = 'lank';
    for (let n = 2; taken.has(id); n++) id = `lank-${n}`;
    state.tools.push({ id, name: 'Ny länk', description: '', url: '', icon: '🔗', tags: [] });
    state.open.add(id);
    render();
  });

  $('#repo-search').addEventListener('input', (event) => {
    state.repoQuery = event.target.value;
    renderRepos();
  });

  $('#btn-token-save').addEventListener('click', async () => {
    const input = $('#token-input');
    await useToken(input.value.trim(), $('#token-storage').value);
    input.value = '';
  });

  $('#btn-token-forget').addEventListener('click', async () => {
    persistToken('', 'session');
    await useToken('', 'session');
    toast('Token borttagen ur webbläsaren.');
  });

  addEventListener('beforeunload', (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

async function main() {
  initControls();
  initDragAndDrop();

  const stored = readStoredToken();
  $('#token-storage').value = stored.where;
  if (stored.token) {
    await useToken(stored.token, stored.where, { quiet: true });
  } else {
    setTokenBadge('ingen token');
  }

  try {
    await loadTools();
  } catch (error) {
    message(`Kunde inte läsa ${DATA_URL}: ${error.message}`, 'danger');
  }

  render();
  await loadRepos();
}

main();
