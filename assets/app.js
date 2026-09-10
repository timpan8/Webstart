/* Startsidan: läser data/tools.json och renderar korten.
   Ingen annan datakälla - det som står i tools.json är det som visas. */

import { $, el, fold } from './dom.js';

const DATA_URL = 'data/tools.json';
const THEME_KEY = 'webstart:theme';

const GITHUB_ICON =
  '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" ' +
  'd="M8 0a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.4c-2 .5-2.5-.9-2.5-.9-.4-.9-.9-1.1-.9-1.1-.7-.5 0-.5 0-.5.8 0 1.2.8 1.2.8.7 1.2 1.9.9 2.3.7 0-.5.3-.9.5-1.1-1.6-.2-3.3-.8-3.3-3.6 0-.8.3-1.5.8-2 0-.2-.4-.9.1-2 0 0 .6-.2 2 .7a7 7 0 0 1 3.6 0c1.4-.9 2-.7 2-.7.5 1.1.1 1.8.1 2 .5.5.8 1.2.8 2 0 2.8-1.7 3.4-3.3 3.6.3.2.5.7.5 1.4v2c0 .2.1.4.5.4A8 8 0 0 0 8 0"/></svg>';

/* ---------- Tema ---------- */

function initTheme() {
  $('#theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';

    /* Byt alla färger i samma bildruta i stället för att låta dem tona i otakt. */
    root.classList.add('theme-switching');
    root.dataset.theme = next;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => root.classList.remove('theme-switching')));

    try { localStorage.setItem(THEME_KEY, next); } catch { /* blockerad lagring */ }
  });
}

/* ---------- Länkupplösning ----------
   Admin skriver normalt en färdig `url`. Saknas den faller vi tillbaka på
   repot, så att en post som en AI lagt till för hand aldrig blir en död länk. */

const repoUrl = (tool) => (tool.repo ? `https://github.com/${tool.repo}` : null);
const targetUrl = (tool) => tool.url || repoUrl(tool);

/* ---------- Rendering ---------- */

function iconNode(tool) {
  if (tool.icon) return el('span', { class: 'card-icon', 'aria-hidden': 'true', text: tool.icon });
  const letter = (tool.name || '?').trim().charAt(0).toUpperCase();
  return el('span', { class: 'card-icon', 'aria-hidden': 'true' },
    el('span', { class: 'card-icon-letter', text: letter }));
}

function cardNode(tool) {
  const href = targetUrl(tool);
  const source = repoUrl(tool);

  const link = el('a', {
    href: href || '#',
    target: '_blank',
    rel: 'noopener noreferrer',
    text: tool.name || tool.id,
  });

  const parts = [
    el('div', { class: 'card-head' }, iconNode(tool), el('h3', { class: 'card-name' }, link)),
    tool.description
      ? el('p', { class: 'card-desc', text: tool.description })
      : el('p', { class: 'card-desc card-desc-empty', text: 'Ingen beskrivning än.' }),
  ];

  if (tool.tags?.length) {
    parts.push(el('div', { class: 'card-tags' },
      tool.tags.map((tag) => el('span', { class: 'tag', text: tag }))));
  }

  /* Källkodslänken är meningsfull bara när den skiljer sig från kortets egen länk. */
  if (source && source !== href) {
    parts.push(el('a', {
      class: 'card-src',
      href: source,
      target: '_blank',
      rel: 'noopener noreferrer',
      title: `Källkod för ${tool.name}`,
      'aria-label': `Källkod för ${tool.name}`,
      html: GITHUB_ICON,
    }));
  }

  return el('article', { class: 'card' }, parts);
}

/* Gruppera på kategori men behåll ordningen från tools.json. */
function groupByCategory(tools) {
  const groups = new Map();
  for (const tool of tools) {
    const key = tool.category?.trim() || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tool);
  }
  return groups;
}

function emptyState({ mark, title, body, action }) {
  return el('div', { class: 'empty' },
    el('div', { class: 'empty-mark', 'aria-hidden': 'true', text: mark }),
    el('h2', { text: title }),
    el('p', { text: body }),
    action ? el('a', { class: 'btn', href: action.href, text: action.label }) : null);
}

/* ---------- Applikation ---------- */

const state = { tools: [], query: '' };

function matches(tool, terms) {
  const hay = fold([tool.name, tool.description, tool.category, ...(tool.tags || [])]
    .filter(Boolean).join(' '));
  return terms.every((term) => hay.includes(term));
}

function update() {
  const content = $('#content');
  const visible = state.tools.filter((tool) => !tool.hidden);
  const terms = fold(state.query).split(/\s+/).filter(Boolean);
  const shown = terms.length ? visible.filter((tool) => matches(tool, terms)) : visible;

  content.replaceChildren();

  if (!visible.length) {
    content.append(emptyState({
      mark: '🧰',
      title: 'Inga verktyg än',
      body: 'Öppna hanteringssidan och bocka i vilka av dina repon som ska listas här.',
      action: { href: 'admin.html', label: 'Öppna hantering' },
    }));
  } else if (!shown.length) {
    content.append(emptyState({
      mark: '🔍',
      title: 'Inget matchar sökningen',
      body: `Hittade inget för "${state.query}". Prova ett annat ord.`,
    }));
  } else {
    const groups = groupByCategory(shown);
    const named = [...groups.keys()].some((key) => key !== '');
    for (const [category, tools] of groups) {
      const grid = el('div', { class: 'grid' }, tools.map(cardNode));
      content.append(named
        ? el('section', { class: 'section' },
            el('h2', { class: 'section-title', text: category || 'Övrigt' }), grid)
        : grid);
    }
  }

  $('#count').textContent = terms.length
    ? `${shown.length} av ${visible.length} verktyg`
    : `${visible.length} verktyg`;
}

/* ---------- Tangentbord ---------- */

function initKeyboard() {
  const search = $('#search');

  search.addEventListener('input', () => { state.query = search.value; update(); });

  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const onSearch = document.activeElement === search;

    if (event.key === '/' && !onSearch) {
      event.preventDefault();
      search.focus();
      search.select();
      return;
    }

    if (event.key === 'Escape' && onSearch) {
      search.value = '';
      state.query = '';
      update();
      search.blur();
      return;
    }

    const links = [...document.querySelectorAll('.card-name a')];
    if (!links.length) return;

    if (event.key === 'Enter' && onSearch) {
      event.preventDefault();
      links[0].click();
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const current = links.indexOf(document.activeElement);

    if (current === -1) {
      if (step === -1 && !onSearch) return;
      event.preventDefault();
      links[step === 1 ? 0 : links.length - 1].focus();
      return;
    }

    const next = current + step;
    if (next < 0) { event.preventDefault(); search.focus(); search.select(); return; }
    if (next >= links.length) return;
    event.preventDefault();
    links[next].focus();
  });
}

/* ---------- Start ---------- */

async function load() {
  const response = await fetch(DATA_URL, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${DATA_URL} svarade ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data?.tools)) throw new Error('tools.json saknar en "tools"-lista');
  return data;
}

async function main() {
  initTheme();
  initKeyboard();

  try {
    const data = await load();
    state.tools = data.tools.filter((tool) => tool && typeof tool === 'object');

    if (data.title) {
      document.title = data.title;
      const brand = document.querySelector('.brand span:last-child');
      if (brand) brand.textContent = data.title;
    }
    update();
  } catch (error) {
    $('#status').append(el('div', { class: 'notice notice-danger' },
      el('strong', { text: 'Kunde inte läsa verktygslistan. ' }),
      el('span', { text: String(error.message || error) })));
    $('#count').textContent = '';
    console.error(error);
  }
}

main();
