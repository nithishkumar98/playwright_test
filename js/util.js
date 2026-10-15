// Small, dependency-free helpers shared by the views.

export const STATUSES = ['passed', 'failed', 'flaky', 'skipped'];
export const STATUS_LABEL = { passed: 'Passed', failed: 'Failed', flaky: 'Flaky', skipped: 'Skipped', timedOut: 'Timed out', interrupted: 'Interrupted' };

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Tagged template that escapes interpolations unless they are wrapped with raw(). */
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) {
      const v = values[i];
      if (v == null || v === false) return;
      if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.v : esc(x))).join('');
      else out += v instanceof Raw ? v.v : esc(v);
    }
  });
  return new Raw(out);
}
class Raw { constructor(v) { this.v = v; } toString() { return this.v; } }
export const raw = (v) => new Raw(v);

export function fmtDuration(ms) {
  if (ms == null || isNaN(ms)) return '–';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  if (m < 60) return `${m}m ${rs}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtDate(iso, opts = {}) {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', ...opts });
}

export function fmtRelative(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 60) return rtf.format(-Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  return rtf.format(-Math.round(diff / 86400), 'day');
}

export const pct = (n, d) => (d ? (n / d) * 100 : 0);
export const fmtPct = (v) => `${v.toFixed(v >= 99.95 || v === 0 ? 0 : 1)}%`;

const ANSI_RE = /\u001b\[[0-9;]*m/g;
export const stripAnsi = (s) => String(s ?? '').replace(ANSI_RE, '');

/** Converts the small ANSI subset Playwright emits (red/green/dim) to HTML. */
export function ansiToHtml(s) {
  let out = '';
  let open = [];
  const close = () => { out += '</span>'.repeat(open.length); open = []; };
  const parts = String(s ?? '').split(/(\u001b\[[0-9;]*m)/);
  for (const p of parts) {
    const m = /^\u001b\[([0-9;]*)m$/.exec(p);
    if (!m) { out += esc(p); continue; }
    for (const code of m[1].split(';').map(Number)) {
      if (code === 0 || code === 39 || code === 22) close();
      else if (code === 31 || code === 91) { out += '<span class="a-red">'; open.push(1); }
      else if (code === 32 || code === 92) { out += '<span class="a-green">'; open.push(1); }
      else if (code === 2) { out += '<span class="a-dim">'; open.push(1); }
    }
  }
  close();
  return out;
}

export function debounce(fn, ms = 150) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function countBy(items, keyFn) {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export function statusCounts(tests) {
  const c = { passed: 0, failed: 0, flaky: 0, skipped: 0, total: tests.length };
  for (const t of tests) c[t.status]++;
  return c;
}

/** Stacked status bar HTML for a counts object. */
export function statusBar(c, label = '') {
  const total = c.passed + c.failed + c.flaky + c.skipped;
  if (!total) return raw('<div class="statusbar"></div>');
  const seg = STATUSES.filter((s) => c[s]).map((s) => `<span class="${s}" style="width:${pct(c[s], total)}%" title="${STATUS_LABEL[s]}: ${c[s]}"></span>`).join('');
  return raw(`<div class="statusbar" role="img" aria-label="${esc(label || `${c.passed} passed, ${c.failed} failed, ${c.flaky} flaky, ${c.skipped} skipped`)}">${seg}</div>`);
}

export const badge = (status) => html`<span class="badge ${status}">${STATUS_LABEL[status] ?? status}</span>`;

export function toast(msg, ms = 3200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), ms);
}

export const shortSha = (sha) => (sha ? String(sha).slice(0, 7) : '');
