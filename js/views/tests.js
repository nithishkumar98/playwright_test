import { html, raw, esc, badge, fmtDuration, STATUSES, STATUS_LABEL, debounce } from '../util.js';
import { link, replaceParams, pickFilters } from '../router.js';

const STATUS_ORDER = { failed: 0, flaky: 1, passed: 2, skipped: 3 };
const PAGE = 200;

export function parseFilters(params) {
  return {
    status: params.status ? params.status.split(',').filter((s) => STATUSES.includes(s)) : [],
    project: params.project ?? '',
    file: params.file ?? '',
    tag: params.tag ?? '',
    q: (params.q ?? '').trim(),
    sort: params.sort ?? 'status',
    dir: params.dir ?? (params.sort === 'duration' || params.sort === 'retries' ? 'desc' : 'asc'),
    group: params.group ?? '',
  };
}

function matches(t, f, skip = '') {
  if (skip !== 'status' && f.status.length && !f.status.includes(t.status)) return false;
  if (f.project && t.project !== f.project) return false;
  if (f.file && t.file !== f.file && !t.file.startsWith(f.file.replace(/\/?$/, '/'))) return false;
  if (f.tag && !t.tags.includes(f.tag)) return false;
  if (f.q) {
    const hay = `${t.title} ${t.describe.join(' ')} ${t.file} ${t.project} ${t.tags.map((x) => '@' + x).join(' ')} ${t.error}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

const cmp = {
  title: (a, b) => a.title.localeCompare(b.title),
  file: (a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || a.project.localeCompare(b.project),
  project: (a, b) => a.project.localeCompare(b.project),
  status: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  duration: (a, b) => a.duration - b.duration,
  retries: (a, b) => a.retries - b.retries,
};

/** Filtered + sorted list for the given URL params (also used for prev/next in the detail view). */
export function filterAndSort(data, params) {
  const f = parseFilters(params);
  const list = data.tests.filter((t) => matches(t, f));
  const c = cmp[f.sort] ?? cmp.status;
  const sign = f.dir === 'desc' ? -1 : 1;
  list.sort((a, b) => sign * c(a, b) || cmp.file(a, b));
  if (f.group === 'file') list.sort((a, b) => a.file.localeCompare(b.file));
  if (f.group === 'project') list.sort((a, b) => a.project.localeCompare(b.project));
  return list;
}

let limit = PAGE;

export function renderTests(ctx) {
  limit = PAGE;
  const { data, params } = ctx;
  return html`
    <div class="view-head">
      <div>
        <h1>Tests</h1>
        <p>${data.tests.length} test results across ${data.files.length} spec files and ${data.projects.length} project(s).</p>
      </div>
    </div>
    <div class="card filters" role="search">
      <div class="search">
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="6"/><path d="M14 14l4 4"/></svg>
        <input type="search" id="q" placeholder="Search title, file, tag, error…" value="${params.q ?? ''}" aria-label="Search tests" autocomplete="off" />
        <kbd aria-hidden="true">/</kbd>
      </div>
      <div id="filter-controls" style="display:contents"></div>
    </div>
    <div class="active-filters" id="active-filters"></div>
    <div class="card">
      <div id="results"></div>
    </div>
  `;
}

export function mountTests(ctx, root) {
  const update = () => {
    root.querySelector('#filter-controls').innerHTML = controls(ctx);
    root.querySelector('#active-filters').innerHTML = activeFilters(ctx);
    root.querySelector('#results').innerHTML = results(ctx);
    ctx.onFiltersChanged?.();
  };
  const set = (patch) => {
    ctx.params = { ...ctx.params, ...patch };
    for (const k of Object.keys(ctx.params)) if (ctx.params[k] === '' || ctx.params[k] == null) delete ctx.params[k];
    replaceParams('tests', ctx.params);
    limit = PAGE;
    update();
  };
  update();

  const q = root.querySelector('#q');
  q.addEventListener('input', debounce(() => set({ q: q.value }), 120));
  q.addEventListener('keydown', (e) => { if (e.key === 'Escape') { q.value = ''; set({ q: '' }); } });

  root.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-status]');
    if (chip) {
      const cur = parseFilters(ctx.params).status;
      const s = chip.dataset.status;
      const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
      return set({ status: next.join(',') });
    }
    const clear = e.target.closest('[data-clear]');
    if (clear) {
      const k = clear.dataset.clear;
      return set(k === 'all' ? { status: '', project: '', file: '', tag: '', q: (q.value = '') } : { [k]: k === 'q' ? (q.value = '') : '' });
    }
    const sort = e.target.closest('[data-sort]');
    if (sort) {
      const f = parseFilters(ctx.params);
      const key = sort.dataset.sort;
      const dir = f.sort === key ? (f.dir === 'asc' ? 'desc' : 'asc') : key === 'duration' || key === 'retries' ? 'desc' : 'asc';
      return set({ sort: key, dir });
    }
    if (e.target.closest('#show-more')) { limit += PAGE; root.querySelector('#results').innerHTML = results(ctx); return; }
    const tagLink = e.target.closest('[data-tag]');
    if (tagLink) { e.preventDefault(); e.stopPropagation(); return set({ tag: tagLink.dataset.tag }); }
    const row = e.target.closest('tr[data-href]');
    if (row && !e.target.closest('a')) location.hash = row.dataset.href;
  });
  root.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-filter]');
    if (sel) set({ [sel.dataset.filter]: sel.value });
  });
  root.addEventListener('keydown', (e) => {
    const row = e.target.closest('tr[data-href]');
    if (row && e.key === 'Enter') location.hash = row.dataset.href;
  });

  // Let the sidebar file tree drive this view without a full re-render.
  return { update: (params) => { ctx.params = params; q.value = params.q ?? ''; limit = PAGE; update(); } };
}

function controls(ctx) {
  const { data, params } = ctx;
  const f = parseFilters(params);
  const base = data.tests.filter((t) => matches(t, f, 'status'));
  const n = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
  base.forEach((t) => n[t.status]++);
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
  return `
    <div class="chips" role="group" aria-label="Status">
      ${STATUSES.map((s) => `<button type="button" class="chip ${s}" data-status="${s}" aria-pressed="${f.status.includes(s)}"><span class="dot ${s}"></span>${STATUS_LABEL[s]} <span class="n">${n[s]}</span></button>`).join('')}
    </div>
    <select data-filter="project" aria-label="Project">${opt('', 'All projects', f.project)}${data.projects.map((p) => opt(p, p, f.project)).join('')}</select>
    <select data-filter="tag" aria-label="Tag">${opt('', 'All tags', f.tag)}${data.tags.map((t) => opt(t, '@' + t, f.tag)).join('')}</select>
    <select data-filter="group" aria-label="Group by">${opt('', 'No grouping', f.group)}${opt('file', 'Group by file', f.group)}${opt('project', 'Group by project', f.group)}</select>
  `;
}

function activeFilters(ctx) {
  const f = parseFilters(ctx.params);
  const pills = [];
  const pill = (k, label) => pills.push(`<span class="pill-x">${esc(label)}<button type="button" data-clear="${k}" aria-label="Remove filter ${esc(label)}">×</button></span>`);
  if (f.status.length) pill('status', `Status: ${f.status.map((s) => STATUS_LABEL[s]).join(', ')}`);
  if (f.file) pill('file', `File: ${f.file}`);
  if (f.project) pill('project', `Project: ${f.project}`);
  if (f.tag) pill('tag', `Tag: @${f.tag}`);
  if (f.q) pill('q', `“${f.q}”`);
  if (!pills.length) return '';
  return `<span>Filtered by</span>${pills.join('')}<button type="button" class="link-btn" data-clear="all">Clear all</button>`;
}

function results(ctx) {
  const { data, params } = ctx;
  const f = parseFilters(params);
  const list = filterAndSort(data, params);
  const filters = pickFilters(params);
  const run = params.run;

  const th = (key, label, cls = '') => {
    const active = f.sort === key;
    return `<th class="${cls}"><button type="button" data-sort="${key}" ${active ? `aria-sort="${f.dir === 'asc' ? 'ascending' : 'descending'}"` : ''}>${label}${active ? `<span class="arrow">${f.dir === 'asc' ? '▲' : '▼'}</span>` : ''}</button></th>`;
  };

  if (!list.length) {
    return `<div class="empty">No tests match these filters. <button type="button" class="link-btn" data-clear="all">Clear filters</button></div>`;
  }

  let lastGroup = null;
  const rows = [];
  for (const t of list.slice(0, limit)) {
    if (f.group) {
      const g = f.group === 'file' ? t.file : t.project;
      if (g !== lastGroup) {
        const inGroup = list.filter((x) => (f.group === 'file' ? x.file : x.project) === g);
        const failed = inGroup.filter((x) => x.status === 'failed').length;
        rows.push(`<tr class="group-row"><td colspan="5">${esc(g)} <span class="muted">· ${inGroup.length} tests${failed ? ` · <span style="color:var(--failed)">${failed} failed</span>` : ''}</span></td></tr>`);
        lastGroup = g;
      }
    }
    const href = link('test', { run, ...filters }, t.key);
    rows.push(String(html`
      <tr data-href="${href}" tabindex="0">
        <td>${badge(t.status)}</td>
        <td>
          <a class="t-title" href="${href}">${t.title}</a>
          <div class="t-path">${t.file}${t.line ? `:${t.line}` : ''}${t.describe.length ? ' › ' + t.describe.join(' › ') : ''}</div>
          ${t.tags.length ? raw(`<div class="t-tags">${t.tags.map((x) => `<a href="#" class="tag" data-tag="${esc(x)}">@${esc(x)}</a>`).join('')}</div>`) : ''}
          ${t.error ? html`<div class="t-err" title="${t.error}">${t.error}</div>` : ''}
        </td>
        <td class="hide-sm"><span class="proj">${t.project}</span></td>
        <td class="num hide-sm">${t.retries || '–'}</td>
        <td class="num">${fmtDuration(t.duration)}</td>
      </tr>`));
  }
  const more = list.length > limit ? `<button type="button" class="btn" id="show-more">Show ${Math.min(PAGE, list.length - limit)} more</button>` : '';
  return `
    <div class="table-wrap">
      <table class="tests-table">
        <thead><tr>${th('status', 'Status')}${th('title', 'Test')}${th('project', 'Project', 'hide-sm')}${th('retries', 'Retries', 'num hide-sm')}${th('duration', 'Duration', 'num')}</tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
    <div class="table-foot"><span>Showing ${Math.min(limit, list.length)} of ${list.length} (${data.tests.length} total)</span>${more}</div>`;
}
