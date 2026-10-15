// App shell: loads the run list, routes between views, and keeps the sidebar,
// run picker and URL in sync.
import { loadManifest, loadRun, runFromReport } from './data.js';
import { parseHash, link, replaceParams, pickFilters } from './router.js';
import { esc, html, fmtDate, fmtDuration, shortSha, statusCounts, toast } from './util.js';
import { installChartInteractions } from './charts.js';
import { renderOverview, mountClickableRows } from './views/overview.js';
import { renderTests, mountTests, parseFilters } from './views/tests.js';
import { renderDetail, mountDetail } from './views/detail.js';
import { renderRuns, mountRuns } from './views/runs.js';

const $ = (s) => document.querySelector(s);
const viewEl = () => document.getElementById('view');
let listening = false;
function listen() { if (!listening) { window.addEventListener('hashchange', route); listening = true; } }

const state = {
  runs: [],
  data: null,
  mounted: null, // controller returned by the current view's mount()
  route: null,
  allRunsPromise: null,
};

// ---------------------------------------------------------------- boot
async function boot() {
  bindView(viewEl());
  wireChrome();
  try {
    state.runs = await loadManifest();
  } catch (err) {
    state.runs = [];
    const fileProto = location.protocol === 'file:';
    viewEl().innerHTML = String(html`
      <div class="card"><div class="card-body" style="padding:28px">
        <h1>Couldn't load <code>storage/manifest.json</code></h1>
        <p class="muted">${fileProto
          ? 'Browsers block fetch() for pages opened straight from disk. Serve the folder over HTTP instead:'
          : err.message}</p>
        ${fileProto ? html`<pre class="code">npx serve .        # or
python3 -m http.server 8080</pre>` : ''}
        <p>You can also drag a Playwright <code>results.json</code> onto this page, or use <b>Load report</b>.</p>
      </div></div>`);
    return;
  }
  if (!state.runs.length) {
    viewEl().innerHTML = `<div class="card"><div class="empty">No reports in <code>storage/reports/</code> yet. Add one and run <code>node scripts/build-manifest.mjs</code>, or drop a <code>results.json</code> here.</div></div>`;
    return;
  }
  listen();
  route();
}

// ---------------------------------------------------------------- routing
async function route() {
  const r = parseHash();
  if (!['overview', 'tests', 'test', 'runs'].includes(r.view)) r.view = 'overview';
  let run = state.runs.find((x) => x.id === r.params.run);
  if (!run) {
    if (r.params.run) toast(`Run "${r.params.run}" not found — showing the latest run.`);
    run = state.runs[0];
    r.params.run = run.id;
    replaceParams(r.view, r.params, r.arg);
  }
  state.route = r;

  if (!state.data || state.data.run.id !== run.id) {
    viewEl().innerHTML = '<div class="loading"><span class="spinner"></span> Loading report…</div>';
    try {
      state.data = await loadRun(run);
    } catch (err) {
      viewEl().innerHTML = `<div class="card"><div class="empty">${esc(err.message)}</div></div>`;
      return;
    }
    if (state.route !== r) return; // a newer navigation started while loading
  }
  render();
}

function ctx() {
  const r = state.route;
  return {
    data: state.data,
    runs: state.runs,
    run: state.data.run,
    params: { ...r.params },
    arg: r.arg,
    loadAllRuns,
    onFiltersChanged: () => { state.route.params = { ...c.params }; renderSidebar(); },
  };
}
let c; // current context (tests view mutates its params)

function render() {
  const r = state.route;
  c = ctx();
  const views = {
    overview: [renderOverview],
    tests: [renderTests, mountTests],
    test: [renderDetail, mountDetail],
    runs: [renderRuns, mountRuns],
  };
  const [renderFn, mountFn] = views[r.view];
  // Replace the element so listeners from the previous view don't pile up.
  const old = viewEl();
  const fresh = old.cloneNode(false);
  old.replaceWith(fresh);
  bindView(fresh);
  fresh.innerHTML = String(renderFn(c));
  state.mounted = mountFn ? mountFn(c, fresh) : null;
  renderChrome();
  document.title = `${titleFor(r)} · PW Reports`;
  window.scrollTo({ top: 0 });
}

function bindView(el) {
  installChartInteractions(el);
  mountClickableRows(el);
}

function titleFor(r) {
  if (r.view === 'test') return state.data.byKey.get(r.arg)?.title ?? 'Test';
  return { overview: 'Overview', tests: 'Tests', runs: 'Runs' }[r.view];
}

// ---------------------------------------------------------------- chrome (topbar + sidebar)
function renderChrome() {
  const r = state.route;
  const data = state.data;
  const run = data.run;

  document.querySelectorAll('[data-nav]').forEach((a) => {
    const v = a.dataset.nav;
    a.classList.toggle('active', v === r.view || (v === 'tests' && r.view === 'test'));
    a.setAttribute('href', link(v, { run: run.id }));
    if (a.classList.contains('active')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  $('#nav-test-count').textContent = data.tests.length;

  const sel = $('#run-select');
  sel.innerHTML = state.runs.map((x, i) => {
    const s = x.stats;
    const label = `${x.source === 'local' ? '📄 ' + x.label : fmtDate(x.startTime)}${i === 0 && x.source !== 'local' ? ' (latest)' : ''} — ${s.failed ? `${s.failed} failed` : 'all passed'}`;
    return `<option value="${esc(x.id)}" ${x.id === run.id ? 'selected' : ''}>${esc(label)}</option>`;
  }).join('');

  const meta = [];
  if (run.branch) meta.push(`<code>${esc(run.branch)}</code>`);
  if (run.commit) meta.push(`<code>${esc(shortSha(run.commit))}</code>`);
  meta.push(esc(fmtDuration(data.stats.duration)));
  const counts = statusCounts(data.tests);
  meta.push(`${counts.passed + counts.flaky}/${counts.total - counts.skipped} passed`);
  $('#run-meta').innerHTML = meta.join(' · ');
  $('#pw-version').textContent = data.config.version ? `Playwright ${data.config.version} · ${data.config.workers ?? '?'} workers` : '';

  renderSidebar();
}

function renderSidebar() {
  const data = state.data;
  const r = state.route;
  const activeFile = r.view === 'tests' ? parseFilters(c.params).file : r.view === 'test' ? data.byKey.get(r.arg)?.file : '';
  const dirs = new Map();
  for (const f of data.files) {
    const i = f.lastIndexOf('/');
    const dir = i > -1 ? f.slice(0, i) : '';
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir).push(f);
  }
  const fileStat = (f) => {
    const ts = data.tests.filter((t) => t.file === f);
    const s = statusCounts(ts);
    return { n: ts.length, cls: s.failed ? 'failed' : s.flaky ? 'flaky' : s.passed ? 'passed' : 'skipped' };
  };
  $('#file-tree').innerHTML = [...dirs.entries()].map(([dir, files]) => `
    <div class="tree-dir" role="group">
      ${dir ? `<div class="tree-dir-name"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4.5h4l1.5 1.5H14v7H2z"/></svg>${esc(dir)}</div>` : ''}
      ${files.map((f) => {
        const st = fileStat(f);
        const name = dir ? f.slice(dir.length + 1) : f;
        return `<button type="button" role="treeitem" class="tree-file${f === activeFile ? ' active' : ''}" data-file="${esc(f)}" title="${esc(f)}" aria-current="${f === activeFile}">
          <span class="dot ${st.cls}"></span><span class="name">${esc(name)}</span><span class="count">${st.n}</span></button>`;
      }).join('')}
    </div>`).join('');
  $('#clear-file').hidden = !(r.view === 'tests' && activeFile);
}

function selectFile(file) {
  const r = state.route;
  if (r.view === 'tests' && state.mounted?.update) {
    const params = { ...c.params, file };
    if (!file) delete params.file;
    replaceParams('tests', params);
    state.route.params = params;
    state.mounted.update(params);
    renderSidebar();
  } else {
    location.hash = link('tests', { run: state.data.run.id, ...(file ? { file } : {}) });
  }
  document.body.classList.remove('nav-open');
}

// ---------------------------------------------------------------- loading all runs (history)
function loadAllRuns() {
  // Re-use the promise unless runs were added since.
  if (!state.allRunsPromise || state.allRunsPromise.count !== state.runs.length) {
    const runs = [...state.runs];
    // A missing/broken report shouldn't hide history for the rest — skip it and warn once.
    const p = Promise.allSettled(runs.map((run) => loadRun(run).then((data) => ({ run, data })))).then((res) => {
      const ok = res.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      const bad = res.length - ok.length;
      if (bad) toast(`${bad} report${bad > 1 ? 's' : ''} listed in manifest.json couldn't be loaded — run "npm run manifest".`, 5000);
      return ok;
    });
    p.count = runs.length;
    state.allRunsPromise = p;
  }
  return state.allRunsPromise;
}

// ---------------------------------------------------------------- uploads
async function openReportFile(file) {
  try {
    const report = JSON.parse(await file.text());
    const run = runFromReport(report, file.name);
    state.runs.unshift(run);
    toast(`Opened ${file.name} (kept in this tab only)`);
    listen();
    location.hash = link('overview', { run: run.id });
  } catch (err) {
    toast(err instanceof SyntaxError ? `${file.name} isn't valid JSON.` : err.message, 5000);
  }
}

// ---------------------------------------------------------------- static chrome wiring
function wireChrome() {
  $('#run-select').addEventListener('change', (e) => {
    const id = e.target.value;
    const r = state.route;
    if (r.view === 'test') {
      // Try to land on the same test in the other run.
      const cur = state.data.byKey.get(r.arg);
      const target = state.runs.find((x) => x.id === id);
      loadRun(target).then((d) => {
        const same = cur && d.tests.find((t) => t.histKey === cur.histKey);
        location.hash = same ? link('test', { ...pickFilters(c.params), run: id }, same.key) : link('tests', { ...pickFilters(c.params), run: id });
      });
      return;
    }
    location.hash = link(r.view, { ...(r.view === 'tests' ? c.params : {}), run: id });
  });

  $('#file-tree').addEventListener('click', (e) => {
    const b = e.target.closest('[data-file]');
    if (b) selectFile(b.classList.contains('active') && state.route.view === 'tests' ? '' : b.dataset.file);
  });
  $('#clear-file').addEventListener('click', () => selectFile(''));

  $('#menu-btn').addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    $('#menu-btn').setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (document.body.classList.contains('nav-open') && (e.target.closest('.nav a') || (!e.target.closest('.sidebar') && !e.target.closest('#menu-btn')))) {
      document.body.classList.remove('nav-open');
    }
  });

  $('#theme-btn').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('pwd-theme', root.dataset.theme); } catch (e) { /* storage unavailable */ }
  });

  $('#file-input').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) openReportFile(f);
    e.target.value = '';
  });

  const overlay = $('#drop-overlay');
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; overlay.hidden = false; } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.hidden = true; });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    const f = e.dataTransfer.files?.[0];
    if (f) openReportFile(f);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') {
      e.preventDefault();
      if (state.route?.view === 'tests') document.querySelector('#q')?.focus();
      else if (state.data) { location.hash = link('tests', { run: state.data.run.id }); setTimeout(() => document.querySelector('#q')?.focus(), 50); }
    }
    if (state.route?.view === 'test' && (e.key === 'j' || e.key === 'k')) {
      const a = document.querySelector(e.key === 'j' ? '#next-test' : '#prev-test');
      if (a?.getAttribute('href')) location.hash = a.getAttribute('href');
    }
    if (e.key === 'Escape') document.body.classList.remove('nav-open');
  });
}

boot();

