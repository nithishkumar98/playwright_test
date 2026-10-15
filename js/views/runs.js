import { html, raw, esc, fmtDuration, fmtDate, fmtPct, fmtRelative, statusBar, shortSha, STATUS_LABEL } from '../util.js';
import { link } from '../router.js';
import { lineChart, barChart } from '../charts.js';
import { passRate, trendPoints, runLabel } from './overview.js';

export function renderRuns(ctx) {
  const { runs, run } = ctx;
  const stored = runs.filter((r) => r.source !== 'local');
  const bars = [...stored].reverse().map((r) => ({
    label: runLabel(r),
    failed: r.stats.failed,
    flaky: r.stats.flaky,
    current: r.id === run.id,
    href: link('runs', { run: r.id }),
    tip: `${fmtDate(r.startTime)} — ${r.stats.failed} failed, ${r.stats.flaky} flaky`,
  }));

  return html`
    <div class="view-head">
      <div>
        <h1>Runs &amp; history</h1>
        <p>${stored.length} stored run${stored.length === 1 ? '' : 's'} in <code>storage/reports/</code>${runs.length > stored.length ? html` · ${runs.length - stored.length} loaded from your computer` : ''}.</p>
      </div>
    </div>

    <div class="grid grid-2">
      <section class="card">
        <div class="card-head"><h2>Pass rate</h2><span class="hint">Click a point to select the run</span></div>
        <div class="card-body">${raw(lineChart(trendPoints(runs, run.id, 'runs')))}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Failed &amp; flaky per run</h2>
          <span class="legend" style="margin:0"><span><span class="dot failed"></span>Failed</span><span><span class="dot flaky"></span>Flaky</span></span>
        </div>
        <div class="card-body">${raw(barChart(bars))}</div>
      </section>
    </div>

    <section class="card mt">
      <div class="card-head"><h2>All runs</h2><span class="hint">Newest first</span></div>
      <div class="card-body table-wrap">
        <table class="mini-table">
          <thead><tr><th>Run</th><th class="hide-sm">Branch</th><th class="hide-sm">Commit</th><th style="width:22%">Status</th><th class="num">Passed</th><th class="num">Failed</th><th class="num">Flaky</th><th class="num">Pass rate</th><th class="num hide-sm">Duration</th></tr></thead>
          <tbody>
            ${runs.map((r) => html`
              <tr class="clickable" data-href="${link('overview', { run: r.id })}" ${r.id === run.id ? raw('style="font-weight:600"') : ''}>
                <td class="nowrap">${r.id === run.id ? '● ' : ''}${r.source === 'local' ? r.label : fmtDate(r.startTime)}<div class="t-path">${r.source === 'local' ? 'loaded locally' : fmtRelative(r.startTime)}</div></td>
                <td class="hide-sm">${r.branch ? html`<code>${r.branch}</code>` : '–'}</td>
                <td class="hide-sm mono">${shortSha(r.commit) || '–'}</td>
                <td>${statusBar(r.stats)}</td>
                <td class="num">${r.stats.passed}</td>
                <td class="num" style="${r.stats.failed ? 'color:var(--failed)' : ''}">${r.stats.failed}</td>
                <td class="num" style="${r.stats.flaky ? 'color:var(--flaky)' : ''}">${r.stats.flaky}</td>
                <td class="num">${fmtPct(passRate(r.stats))}</td>
                <td class="num muted hide-sm">${fmtDuration(r.duration)}</td>
              </tr>`)}
          </tbody>
        </table>
      </div>
    </section>

    <section class="card mt">
      <div class="card-head"><h2>Least stable tests</h2><span class="hint">Failed or flaky most often across stored runs</span></div>
      <div class="card-body table-wrap" id="unstable"><div class="loading" style="padding:4px 0"><span class="spinner"></span> Analysing all runs…</div></div>
    </section>
  `;
}

export function mountRuns(ctx, root) {
  ctx.loadAllRuns().then((all) => {
    const el = root.querySelector('#unstable');
    if (!el) return;
    const ordered = [...all].reverse(); // oldest → newest
    const agg = new Map();
    ordered.forEach(({ run, data }, i) => {
      for (const t of data.tests) {
        if (!agg.has(t.histKey)) agg.set(t.histKey, { t, cells: new Array(ordered.length).fill(null), bad: 0, failed: 0, flaky: 0, ran: 0 });
        const a = agg.get(t.histKey);
        a.cells[i] = { status: t.status, run, key: t.key };
        a.t = t;
        if (t.status !== 'skipped') a.ran++;
        if (t.status === 'failed') { a.failed++; a.bad++; }
        if (t.status === 'flaky') { a.flaky++; a.bad++; }
      }
    });
    const top = [...agg.values()].filter((a) => a.bad).sort((a, b) => b.bad - a.bad || b.failed - a.failed).slice(0, 12);
    if (!top.length) { el.innerHTML = '<div class="empty">Every test passed first time in every run.</div>'; return; }
    el.innerHTML = String(html`
      <table class="mini-table">
        <thead><tr><th>Test</th><th class="hide-sm">Project</th><th>Runs (oldest → newest)</th><th class="num">Failed</th><th class="num">Flaky</th><th class="num">Instability</th></tr></thead>
        <tbody>
          ${top.map((a) => html`
            <tr class="clickable" data-href="${link('test', { run: ctx.run.id }, a.t.key)}">
              <td class="truncate" style="width:40%"><span title="${a.t.title}">${a.t.title}</span><div class="t-path">${a.t.file}</div></td>
              <td class="hide-sm"><span class="proj">${a.t.project}</span></td>
              <td><div class="history">${a.cells.map((c) => c
                ? html`<a class="bg-${c.status}${c.run.id === ctx.run.id ? ' current' : ''}" style="width:14px;height:14px;border-radius:3px" href="${link('test', { run: c.run.id }, c.key)}" title="${fmtDate(c.run.startTime)}: ${STATUS_LABEL[c.status]}"></a>`
                : html`<a class="none" style="width:14px;height:14px;border-radius:3px" title="not run"></a>`)}</div></td>
              <td class="num" style="color:var(--failed)">${a.failed || '–'}</td>
              <td class="num" style="color:var(--flaky)">${a.flaky || '–'}</td>
              <td class="num">${fmtPct((a.bad / Math.max(1, a.ran)) * 100)}</td>
            </tr>`)}
        </tbody>
      </table>`);
  }).catch((err) => {
    const el = root.querySelector('#unstable');
    if (el) el.innerHTML = `<span class="muted">${esc(err.message)}</span>`;
  });
}
