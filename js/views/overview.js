import { html, raw, esc, fmtDuration, fmtDate, fmtPct, pct, statusCounts, statusBar, badge, STATUSES, STATUS_LABEL, shortSha } from '../util.js';
import { link } from '../router.js';
import { lineChart } from '../charts.js';
import { errorSummary } from '../data.js';

/** Pass rate = tests that ultimately passed (incl. flaky) / tests that ran (excl. skipped). */
export function passRate(s) {
  const ran = s.passed + s.failed + s.flaky;
  return ran ? ((s.passed + s.flaky) / ran) * 100 : 100;
}

export function runLabel(r) {
  return r.source === 'local' ? r.label : fmtDate(r.startTime, { hour: undefined, minute: undefined });
}

export function trendPoints(runs, currentId, view = 'overview') {
  return [...runs]
    .filter((r) => r.source !== 'local')
    .reverse()
    .map((r) => ({
      label: runLabel(r),
      value: passRate(r.stats),
      current: r.id === currentId,
      href: link(view, { run: r.id }),
      tip: `${fmtDate(r.startTime)}${r.branch ? ' · ' + r.branch : ''} — ${fmtPct(passRate(r.stats))} pass · ${r.stats.failed} failed · ${r.stats.flaky} flaky`,
    }));
}

export function renderOverview(ctx) {
  const { data, runs, run } = ctx;
  const c = statusCounts(data.tests);
  const rate = passRate(c);
  const idx = runs.findIndex((r) => r.id === run.id);
  const prev = runs.slice(idx + 1).find((r) => r.source !== 'local');
  const prevRate = prev ? passRate(prev.stats) : null;
  const delta = prevRate == null || run.source === 'local' ? null : rate - prevRate;
  const R = run.id;
  const t = (status) => link('tests', { run: R, status });

  // By project
  const byProject = data.projects.map((p) => ({ p, c: statusCounts(data.tests.filter((x) => x.project === p)), d: data.tests.filter((x) => x.project === p).reduce((a, x) => a + x.duration, 0) }));

  // By file
  const byFile = data.files.map((f) => {
    const ts = data.tests.filter((x) => x.file === f);
    return { f, c: statusCounts(ts), d: ts.reduce((a, x) => a + x.duration, 0) };
  }).sort((a, b) => b.c.failed - a.c.failed || b.c.flaky - a.c.flaky || a.f.localeCompare(b.f));

  // Failure reasons (failed + flaky first attempts), grouped by the first line of the error
  const reasons = new Map();
  for (const x of data.tests.filter((x) => x.status === 'failed' || x.status === 'flaky')) {
    const r = x.results.find((r) => r.error || r.errors?.length);
    const msg = errorSummary(r?.error?.message ?? r?.errors?.[0]?.message ?? '') || 'Unknown error';
    if (!reasons.has(msg)) reasons.set(msg, []);
    reasons.get(msg).push(x);
  }
  const topReasons = [...reasons.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6);

  const slowest = [...data.tests].filter((x) => x.status !== 'skipped').sort((a, b) => b.duration - a.duration).slice(0, 8);
  const meta = data.config.metadata ?? {};

  const kpi = (cls, label, value, sub, href) => html`<a class="kpi ${cls}" href="${href}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></a>`;

  return html`
    <div class="view-head">
      <div>
        <h1>Run overview</h1>
        <p>
          ${fmtDate(run.startTime, { weekday: 'short', year: 'numeric' })}
          · ${fmtDuration(data.stats.duration)}
          ${run.branch ? html`· <code>${run.branch}</code>` : ''}
          ${run.commit ? html`· <code title="${run.commit}">${shortSha(run.commit)}</code>` : ''}
          ${meta['ci.buildHref'] ? html`· <a href="${meta['ci.buildHref']}" target="_blank" rel="noopener">CI build ↗</a>` : ''}
        </p>
      </div>
      ${c.failed ? html`<a class="btn" href="${t('failed')}"><span class="dot failed"></span>Review ${c.failed} failure${c.failed > 1 ? 's' : ''}</a>` : ''}
    </div>

    <div class="kpis">
      ${kpi('accent', 'Total tests', c.total, `${data.files.length} files · ${data.projects.length} projects`, link('tests', { run: R }))}
      ${kpi('passed', 'Passed', c.passed, fmtPct(pct(c.passed, c.total)) + ' of total', t('passed'))}
      ${kpi('failed', 'Failed', c.failed, fmtPct(pct(c.failed, c.total)) + ' of total', t('failed'))}
      ${kpi('flaky', 'Flaky', c.flaky, 'passed on retry', t('flaky'))}
      ${kpi('skipped', 'Skipped', c.skipped, 'not executed', t('skipped'))}
      <a class="kpi ${rate >= 95 ? 'passed' : rate >= 85 ? 'flaky' : 'failed'}" href="${link('runs', { run: R })}">
        <div class="kpi-label">Pass rate</div>
        <div class="kpi-value">${fmtPct(rate)}${delta != null && Math.abs(delta) >= 0.05 ? html`<span class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}</span>` : ''}</div>
        <div class="kpi-sub">${prev ? 'vs previous run' : 'incl. flaky, excl. skipped'}</div>
      </a>
    </div>

    <div class="grid grid-3">
      <section class="card">
        <div class="card-head"><h2>Pass rate trend</h2><span class="hint">Click a point to open that run</span></div>
        <div class="card-body">${raw(lineChart(trendPoints(runs, run.id)))}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Status breakdown</h2></div>
        <div class="card-body">
          ${statusBar(c)}
          <div class="legend">
            ${STATUSES.map((s) => html`<a href="${t(s)}"><span class="dot ${s}"></span>${STATUS_LABEL[s]} <b>${c[s]}</b></a>`)}
          </div>
          <table class="mini-table mt">
            <thead><tr><th>Project</th><th></th><th class="num">Failed</th><th class="num">Time</th></tr></thead>
            <tbody>
              ${byProject.map(({ p, c: pc, d }) => html`
                <tr class="clickable" data-href="${link('tests', { run: R, project: p })}">
                  <td><span class="proj">${p}</span></td>
                  <td style="width:45%">${statusBar(pc)}</td>
                  <td class="num" style="${pc.failed ? 'color:var(--failed);font-weight:600' : ''}">${pc.failed}</td>
                  <td class="num muted">${fmtDuration(d)}</td>
                </tr>`)}
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <div class="grid grid-2 mt">
      <section class="card">
        <div class="card-head"><h2>Top failure reasons</h2><span class="hint">Failed + flaky, grouped by error</span></div>
        <div class="card-body">
          ${topReasons.length ? topReasons.map(([msg, ts]) => html`
            <div class="reason">
              <span class="reason-count">${ts.length}</span>
              <div style="min-width:0">
                <div class="reason-msg">${msg}</div>
                <div class="reason-tests">
                  ${ts.slice(0, 3).map((x, i) => html`${i ? ', ' : ''}<a href="${link('test', { run: R }, x.key)}">${x.title}</a> <span class="muted">(${x.project})</span>`)}
                  ${ts.length > 3 ? html` and ${ts.length - 3} more` : ''}
                </div>
              </div>
            </div>`) : html`<div class="empty">No failures in this run 🎉</div>`}
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Slowest tests</h2><a class="hint" href="${link('tests', { run: R, sort: 'duration', dir: 'desc' })}">See all →</a></div>
        <div class="card-body">
          <table class="mini-table">
            <tbody>
              ${slowest.map((x) => html`
                <tr class="clickable" data-href="${link('test', { run: R, sort: 'duration', dir: 'desc' }, x.key)}">
                  <td class="truncate" style="width:100%"><span title="${x.title}">${x.title}</span><div class="t-path">${x.file}</div></td>
                  <td><span class="proj">${x.project}</span></td>
                  <td>${badge(x.status)}</td>
                  <td class="num">${fmtDuration(x.duration)}</td>
                </tr>`)}
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <section class="card mt">
      <div class="card-head"><h2>Spec files</h2><span class="hint">Sorted by failures</span></div>
      <div class="card-body table-wrap">
        <table class="mini-table">
          <thead><tr><th>File</th><th class="num">Tests</th><th style="width:30%">Status</th><th class="num">Failed</th><th class="num">Flaky</th><th class="num hide-sm">Duration</th></tr></thead>
          <tbody>
            ${byFile.map(({ f, c: fc, d }) => html`
              <tr class="clickable" data-href="${link('tests', { run: R, file: f })}">
                <td><span class="dot ${fc.failed ? 'failed' : fc.flaky ? 'flaky' : 'passed'}" style="display:inline-block;margin-right:8px"></span><span class="mono">${f}</span></td>
                <td class="num">${fc.total}</td>
                <td>${statusBar(fc)}</td>
                <td class="num" style="${fc.failed ? 'color:var(--failed);font-weight:600' : ''}">${fc.failed || '–'}</td>
                <td class="num" style="${fc.flaky ? 'color:var(--flaky);font-weight:600' : ''}">${fc.flaky || '–'}</td>
                <td class="num muted hide-sm">${fmtDuration(d)}</td>
              </tr>`)}
          </tbody>
        </table>
      </div>
    </section>

    ${data.globalErrors.length ? html`
      <section class="card mt">
        <div class="card-head"><h2>Global errors</h2></div>
        <div class="card-body">${data.globalErrors.map((e) => html`<pre class="code">${errorSummary(e.message)}</pre>`)}</div>
      </section>` : ''}
  `;
}

export function mountClickableRows(root) {
  root.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-href]');
    if (row && !e.target.closest('a')) location.hash = row.dataset.href;
  });
}

export { esc };
