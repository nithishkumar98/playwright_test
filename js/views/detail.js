import { html, raw, esc, badge, fmtDuration, fmtDate, ansiToHtml, stripAnsi, STATUS_LABEL } from '../util.js';
import { link, pickFilters } from '../router.js';
import { filterAndSort } from './tests.js';

let selectedAttempt = null;

export function renderDetail(ctx) {
  const { data, params, arg } = ctx;
  const t = data.byKey.get(arg);
  const filters = pickFilters(params);
  const back = link('tests', { run: params.run, ...filters });
  if (!t) {
    return html`<div class="card"><div class="empty">This test isn't in the selected run. <a href="${back}">Back to tests</a></div></div>`;
  }
  const list = filterAndSort(data, params);
  const i = list.findIndex((x) => x.key === t.key);
  const prev = i > 0 ? list[i - 1] : null;
  const next = i > -1 && i < list.length - 1 ? list[i + 1] : null;
  const siblings = data.tests.filter((x) => x.specKey === t.specKey);
  const failingIdx = t.results.findIndex((r) => r.status !== 'passed' && r.status !== 'skipped');
  selectedAttempt = failingIdx > -1 ? failingIdx : t.results.length - 1;
  const R = params.run;

  return html`
    <nav class="crumbs" aria-label="Breadcrumb">
      <a href="${back}">← Tests</a><span class="sep">/</span>
      <a href="${link('tests', { run: R, file: t.file })}">${t.file}</a>
      ${t.describe.map((d) => html`<span class="sep">›</span><span>${d}</span>`)}
    </nav>
    <div class="detail-head">
      <div style="min-width:0">
        <h1>${t.title}</h1>
        <div class="detail-meta">
          ${badge(t.status)}
          <a class="proj" href="${link('tests', { run: R, project: t.project })}">${t.project}</a>
          <span>${fmtDuration(t.duration)}</span>
          ${t.retries ? html`<span>· ${t.retries} retr${t.retries > 1 ? 'ies' : 'y'}</span>` : ''}
          <span class="muted mono">${t.file}:${t.line ?? ''}</span>
          ${t.tags.map((x) => html`<a class="tag" href="${link('tests', { run: R, tag: x })}">@${x}</a>`)}
        </div>
      </div>
      <div class="detail-nav">
        <a class="btn ${prev ? '' : 'disabled'}" ${prev ? raw(`href="${esc(link('test', { run: R, ...filters }, prev.key))}"`) : raw('aria-disabled="true" style="opacity:.45;pointer-events:none"')} id="prev-test" title="Previous (k)">← Prev</a>
        <a class="btn ${next ? '' : 'disabled'}" ${next ? raw(`href="${esc(link('test', { run: R, ...filters }, next.key))}"`) : raw('aria-disabled="true" style="opacity:.45;pointer-events:none"')} id="next-test" title="Next (j)">Next →</a>
      </div>
    </div>
    ${i > -1 ? html`<p class="muted" style="margin:-8px 0 14px;font-size:12.5px">${i + 1} of ${list.length} in the current filter · use <kbd>j</kbd>/<kbd>k</kbd> to move</p>` : ''}

    <div class="grid grid-3">
      <section class="card" style="min-width:0">
        <div class="tabs" role="tablist" aria-label="Attempts">
          ${t.results.map((r, idx) => html`
            <button type="button" class="tab" role="tab" data-attempt="${idx}" aria-selected="${idx === selectedAttempt}">
              ${idx === 0 ? 'Run' : `Retry #${r.retry ?? idx}`} <span class="badge ${r.status}">${STATUS_LABEL[r.status] ?? r.status}</span>
            </button>`)}
        </div>
        <div id="attempt">${raw(attemptPanel(t, selectedAttempt))}</div>
      </section>

      <div class="stack">
        <section class="card">
          <div class="card-head"><h2>Details</h2></div>
          <div class="card-body">
            <ul class="side-list">
              <li><span class="k">Outcome</span><span class="v">${t.rawStatus ?? '–'}</span></li>
              <li><span class="k">Expected</span><span class="v">${t.expectedStatus ?? '–'}</span></li>
              <li><span class="k">Project</span><span class="v">${t.project}</span></li>
              <li><span class="k">Timeout</span><span class="v">${t.timeout ? fmtDuration(t.timeout) : '–'}</span></li>
              <li><span class="k">Started</span><span class="v">${fmtDate(t.results[0]?.startTime, { second: '2-digit' })}</span></li>
              <li><span class="k">Worker</span><span class="v">${t.results[0]?.workerIndex ?? '–'}</span></li>
              ${t.annotations.map((a) => html`<li><span class="k">${a.type}</span><span class="v">${/^https?:\/\//.test(a.description ?? '') ? html`<a href="${a.description}" target="_blank" rel="noopener">${a.description.replace(/^https?:\/\//, '')}</a>` : a.description ?? ''}</span></li>`)}
            </ul>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h2>Across projects</h2></div>
          <div class="card-body">
            <ul class="side-list">
              ${siblings.map((s) => html`<li><a href="${link('test', { run: R, ...filters }, s.key)}" ${s.key === t.key ? raw('aria-current="page" style="font-weight:600"') : ''}>${s.project}</a><span class="v">${badge(s.status)} <span class="muted">${fmtDuration(s.duration)}</span></span></li>`)}
            </ul>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h2>History</h2><span class="hint">Oldest → newest</span></div>
          <div class="card-body" id="history"><div class="loading" style="padding:4px 0"><span class="spinner"></span> Loading runs…</div></div>
        </section>
      </div>
    </div>
  `;
}

export function mountDetail(ctx, root) {
  const t = ctx.data.byKey.get(ctx.arg);
  if (!t) return;
  root.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-attempt]');
    if (!tab) return;
    selectedAttempt = Number(tab.dataset.attempt);
    root.querySelectorAll('[data-attempt]').forEach((b) => b.setAttribute('aria-selected', String(b === tab)));
    root.querySelector('#attempt').innerHTML = attemptPanel(t, selectedAttempt);
  });

  // History across stored runs (loads every report lazily, cached afterwards)
  ctx.loadAllRuns().then((all) => {
    const el = root.querySelector('#history');
    if (!el) return;
    const cells = [...all].reverse().map(({ run, data }) => {
      const h = data.tests.find((x) => x.histKey === t.histKey);
      const label = `${fmtDate(run.startTime)}${run.branch ? ' · ' + run.branch : ''}: ${h ? STATUS_LABEL[h.status] + ' · ' + fmtDuration(h.duration) : 'not run'}`;
      if (!h) return `<a class="none" title="${esc(label)}" aria-label="${esc(label)}"></a>`;
      return `<a class="bg-${h.status}${run.id === ctx.run.id ? ' current' : ''}" href="${esc(link('test', { run: run.id }, h.key))}" title="${esc(label)}" aria-label="${esc(label)}"></a>`;
    });
    const hits = all.map(({ data }) => data.tests.find((x) => x.histKey === t.histKey)).filter(Boolean);
    const bad = hits.filter((h) => h.status === 'failed' || h.status === 'flaky').length;
    el.innerHTML = `<div class="history">${cells.join('')}</div><p class="muted" style="margin:10px 0 0;font-size:12.5px">${bad} of ${hits.length} runs failed or were flaky.</p>`;
  }).catch((err) => {
    const el = root.querySelector('#history');
    if (el) el.innerHTML = `<span class="muted">${esc(err.message)}</span>`;
  });
}

function attemptPanel(t, idx) {
  const r = t.results[idx];
  if (!r) return '<div class="empty">No results recorded.</div>';
  const errors = r.errors?.length ? r.errors : r.error ? [r.error] : [];
  const sections = [];

  if (errors.length) {
    sections.push(`<div class="section"><h3>Error${errors.length > 1 ? 's' : ''}</h3>${errors.map((e, i) => {
      const full = i === 0 && r.error ? r.error : e;
      return `<pre class="code">${ansiToHtml(e.message ?? '')}</pre>
        ${full.snippet ? `<pre class="code" style="margin-top:8px">${snippetHtml(full.snippet)}</pre>` : ''}
        ${full.stack ? `<details class="stack"><summary>Stack trace</summary><pre class="code">${ansiToHtml(full.stack)}</pre></details>` : ''}`;
    }).join('')}</div>`);
  }

  if (r.steps?.length) {
    const max = Math.max(1, ...r.steps.map((s) => s.duration ?? 0));
    sections.push(`<div class="section"><h3>Steps <span class="muted">${countSteps(r.steps)}</span></h3><ul class="steps">${stepsHtml(r.steps, max)}</ul></div>`);
  }

  if (r.attachments?.length) {
    sections.push(`<div class="section"><h3>Attachments <span class="muted">${r.attachments.length}</span></h3><div class="attachments">${r.attachments.map(attachmentHtml).join('')}</div>
      <p class="muted" style="font-size:12px;margin:10px 0 0">Paths are relative to the machine that ran the tests. Copy <code>test-results/</code> into <code>storage/</code> to open them here.</p></div>`);
  }

  for (const [k, label] of [['stdout', 'Standard output'], ['stderr', 'Standard error']]) {
    const lines = (r[k] ?? []).map((x) => (typeof x === 'string' ? x : x.text ?? (x.buffer ? atob(x.buffer) : ''))).join('');
    if (lines.trim()) sections.push(`<div class="section"><h3>${label}</h3><pre class="code">${ansiToHtml(lines)}</pre></div>`);
  }

  const head = `<div class="section" style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--text-2)">
    <span>${badge(r.status)}</span><span>Duration <b>${fmtDuration(r.duration)}</b></span>
    <span>Started <b>${esc(fmtDate(r.startTime, { second: '2-digit' }))}</b></span>
    <span>Worker <b>${esc(r.workerIndex ?? '–')}</b></span></div>`;

  if (!errors.length && !r.steps?.length && !r.attachments?.length) {
    sections.push(`<div class="empty">${r.status === 'skipped' ? 'This test was skipped.' : 'Passed with no recorded steps.'}</div>`);
  }
  return head + sections.join('');
}

function snippetHtml(snippet) {
  return snippet.split('\n').map((line) => {
    const h = ansiToHtml(line);
    return stripAnsi(line).trimStart().startsWith('>') ? `<span class="hl">${h}</span>` : h;
  }).join('\n');
}

function countSteps(steps) {
  return steps.reduce((a, s) => a + 1 + countSteps(s.steps ?? []), 0);
}

function stepsHtml(steps, max) {
  return steps.map((s) => {
    const err = !!s.error;
    const ico = err
      ? '<svg class="step-ico err" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#fff" stroke-width="1.6"/></svg>'
      : '<svg class="step-ico ok" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const w = Math.max(2, ((s.duration ?? 0) / max) * 100);
    return `<li><div class="step${err ? ' err' : ''}">${ico}<span class="step-title" title="${esc(s.title)}">${esc(s.title)}</span><span class="step-bar"><span style="width:${w}%"></span></span><span class="step-dur">${fmtDuration(s.duration)}</span></div>
      ${err && s.error?.message ? `<pre class="code" style="margin:4px 0 8px 26px;font-size:11.5px">${ansiToHtml(String(s.error.message).split('\n').slice(0, 4).join('\n'))}</pre>` : ''}
      ${s.steps?.length ? `<ul>${stepsHtml(s.steps, max)}</ul>` : ''}</li>`;
  }).join('');
}

function attachmentHtml(a) {
  const isImg = a.contentType?.startsWith('image/');
  const icon = isImg
    ? '<svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="M4 15l4-4 3 3 2-2 3 3"/></svg>'
    : a.contentType?.startsWith('video/')
      ? '<svg viewBox="0 0 20 20"><rect x="3" y="5" width="10" height="10" rx="2"/><path d="M13 9l4-2v6l-4-2z"/></svg>'
      : '<svg viewBox="0 0 20 20"><path d="M6 3h6l4 4v10H6z"/><path d="M12 3v4h4"/></svg>';
  const src = a.path ? `storage/${a.path.replace(/^.*?(test-results\/)/, '$1')}` : a.body ? `data:${a.contentType};base64,${a.body}` : null;
  const inner = `${icon}<div style="min-width:0"><div class="a-name">${esc(a.name)}</div><div class="a-path" title="${esc(a.path ?? a.contentType)}">${esc(a.path ?? a.contentType)}</div></div>`;
  return src ? `<a class="attachment" href="${esc(src)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="attachment">${inner}</div>`;
}
